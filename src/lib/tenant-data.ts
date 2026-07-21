/**
 * Tenant data export + deletion primitives.
 *
 * Why: GDPR Art. 15 (right of access / data portability) and Art. 17 (right
 * to erasure), plus every procurement security review ever conducted. Even
 * without a regulatory mandate, every paying customer should be able to
 * walk away with their data and have it actually deleted when they leave.
 *
 * Exports: a single JSON bundle of every domain table scoped to the org.
 * Simple format, easy to re-import, easy to eyeball. No ZIP — callers serve
 * it with a `Content-Disposition: attachment` header and browsers handle
 * the download.
 *
 * Deletion: two-step with a 30-day grace window.
 *   1. `scheduleOrgDeletion(orgId)` — sets deletion_scheduled_at = now + 30d.
 *      Owner can call `cancelOrgDeletion(orgId)` anytime within the window
 *      to abort with zero data loss.
 *   2. Nightly cron calls `purgeOrgData(orgId)` once the window has elapsed.
 *      Wipes every domain row + storage files, then stamps deleted_at as a
 *      tombstone on the organizations row (kept to prevent id reuse).
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Every public table that holds tenant-scoped data. The `organizations` row
 * itself is handled separately — it's both the anchor for all the rows
 * below and the tombstone after purge.
 */
const TENANT_TABLES = [
  "audit_log",
  "availability_overrides",
  "availability_slots",
  "bonus_rules",
  "bonuses",
  "booking_assignees",
  "booking_checklist_items",
  "booking_member_calendar_events",
  "booking_requests",
  "booking_series",
  "bookings",
  "chat_messages",
  "chat_thread_members",
  "chat_threads",
  "checklist_template_items",
  "checklist_templates",
  "clients",
  "contract_documents",
  "contracts",
  "estimate_line_items",
  "estimates",
  "feed_posts",
  "freelancer_contacts",
  "integration_connections",
  "integration_events",
  "inventory_items",
  "inventory_log",
  "invitations",
  "invoice_line_items",
  "invoice_payments",
  "invoice_series",
  "invoices",
  "job_offer_claims",
  "job_offer_dispatches",
  "job_offers",
  "job_photos",
  "membership_admin_data",
  "memberships",
  "notifications",
  "packages",
  "payroll_items",
  "payroll_runs",
  "promo_codes",
  "promo_redemptions",
  "pto_balances",
  "pto_requests",
  "push_subscriptions",
  "reviews",
  "scheduler_views",
  "subscriptions",
  "tasks",
  "time_entries",
  "training_assignments",
  "training_modules",
  "training_steps",
  "webhook_deliveries",
  "webhook_subscriptions",
  "webhooks",
] as const;

const DELETION_GRACE_DAYS = 30;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportBundle = {
  exported_at: string;
  organization: Record<string, unknown> | null;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
  /** bucket → time-limited signed download URLs for the org's stored files. */
  storage_files?: Record<string, string[]>;
};

/**
 * Gather every row this org owns into a single JSON bundle. Uses the
 * service-role client so RLS doesn't trim anything — the caller is
 * responsible for verifying the requester is an owner/admin of `orgId`
 * BEFORE calling this.
 */
export async function exportOrgData(orgId: string): Promise<ExportBundle> {
  const db = createSupabaseAdminClient();

  const { data: org } = await db
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const tableName of TENANT_TABLES) {
    const { data, error } = await db
      // Some tables (e.g. booking_series) aren't in the generated types
      // yet; the admin client bypasses the type narrowing at runtime.
      .from(tableName as never)
      .select("*")
      .eq("organization_id" as never, orgId as never);
    if (error) {
      // Log and skip — better to ship a partial bundle than to fail the
      // whole export because one table errored.
      console.error(`[tenant-export] ${tableName} failed:`, error.message);
      tables[tableName] = [];
      counts[tableName] = 0;
      continue;
    }
    tables[tableName] = data ?? [];
    counts[tableName] = data?.length ?? 0;
  }

  // Storage files (job photos, contract/estimate PDFs, org logo). Data
  // portability (GDPR Art. 20) covers user-provided files, not just DB rows.
  // We can't inline MBs of binary in JSON, so include 7-day signed download
  // URLs. Best-effort per bucket — a listing error never fails the export.
  const storage_files: Record<string, string[]> = {};
  const exportBuckets = [
    "org-assets",
    "contract-docs",
    "estimate-pdfs",
    "job-photos",
  ];
  async function listStoragePaths(bucket: string, prefix: string): Promise<string[]> {
    const out: string[] = [];
    let offset = 0;
    const PAGE = 1000;
    for (;;) {
      const { data: listed, error } = await db.storage
        .from(bucket)
        .list(prefix, { limit: PAGE, offset });
      if (error || !listed || listed.length === 0) break;
      for (const entry of listed) {
        const path = `${prefix}/${entry.name}`;
        // Folders come back with a null id — recurse one level into them.
        if (!entry.id) {
          out.push(...(await listStoragePaths(bucket, path)));
        } else {
          out.push(path);
        }
      }
      if (listed.length < PAGE) break;
      offset += PAGE;
      if (offset >= 100_000) break;
    }
    return out;
  }
  for (const bucket of exportBuckets) {
    try {
      const paths = await listStoragePaths(bucket, orgId);
      if (paths.length === 0) continue;
      const { data: signed } = await db.storage
        .from(bucket)
        .createSignedUrls(paths, 60 * 60 * 24 * 7);
      const urls = (signed ?? [])
        .map((s) => s.signedUrl)
        .filter((u): u is string => Boolean(u));
      if (urls.length > 0) storage_files[bucket] = urls;
    } catch (err) {
      console.error(`[tenant-export] storage ${bucket} failed:`, err);
    }
  }

  return {
    exported_at: new Date().toISOString(),
    organization: org as Record<string, unknown> | null,
    tables,
    counts,
    storage_files,
  };
}

// ---------------------------------------------------------------------------
// Deletion scheduling
// ---------------------------------------------------------------------------

export type DeletionStatus = {
  scheduled_at: string | null;
  purge_at: string | null;
  days_remaining: number | null;
  deleted_at: string | null;
};

export async function getOrgDeletionStatus(
  orgId: string,
): Promise<DeletionStatus> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("organizations")
    .select("deletion_scheduled_at, deleted_at")
    .eq("id", orgId)
    .maybeSingle() as unknown as {
    data: { deletion_scheduled_at: string | null; deleted_at: string | null } | null;
  };

  const scheduled = data?.deletion_scheduled_at ?? null;
  const purgeAt = scheduled
    ? new Date(
        new Date(scheduled).getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null;
  const daysRemaining = purgeAt
    ? Math.max(
        0,
        Math.ceil((new Date(purgeAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      )
    : null;

  return {
    scheduled_at: scheduled,
    purge_at: purgeAt,
    days_remaining: daysRemaining,
    deleted_at: data?.deleted_at ?? null,
  };
}

/**
 * Mark an org for deletion. Sets deletion_scheduled_at=now — the cron
 * purges anything whose scheduled_at + 30d has elapsed. Caller must verify
 * role === 'owner' BEFORE calling.
 */
export async function scheduleOrgDeletion(orgId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("organizations")
    .update({ deletion_scheduled_at: new Date().toISOString() } as never)
    .eq("id", orgId);
}

/**
 * Abort a pending deletion. No-op if none is scheduled. Owner-only.
 */
export async function cancelOrgDeletion(orgId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("organizations")
    .update({ deletion_scheduled_at: null } as never)
    .eq("id", orgId);
}

// ---------------------------------------------------------------------------
// Hard purge — called by the cron
// ---------------------------------------------------------------------------

/**
 * Permanently delete every row and file belonging to the org, then stamp
 * `deleted_at` on the organizations row. The organizations row itself is
 * kept as a tombstone to prevent id collisions.
 *
 * Returns counts per table so the cron can log what was wiped.
 */
export async function purgeOrgData(
  orgId: string,
): Promise<{
  tables: Record<string, number>;
  storageFilesRemoved: number;
  authUsersDeleted: number;
}> {
  const db = createSupabaseAdminClient();
  const tableCounts: Record<string, number> = {};

  // Capture member identities BEFORE their membership rows are deleted below.
  // After the purge we erase the auth users whose ONLY membership was in this
  // org — otherwise their login identity + email lingers in Supabase Auth after
  // a "permanent" deletion (right-to-erasure gap).
  const { data: memberRows } = (await db
    .from("memberships")
    .select("profile_id")
    .eq("organization_id", orgId)) as unknown as {
    data: Array<{ profile_id: string | null }> | null;
  };
  const memberProfileIds = [
    ...new Set(
      (memberRows ?? [])
        .map((m) => m.profile_id)
        .filter((p): p is string => Boolean(p)),
    ),
  ];

  // Clean Google Calendar events BEFORE wiping any rows. Deleting the booking
  // rows (below) and the integration_connections token strands every event as
  // an orphan on the (possibly shared) calendar with no way left to reach it —
  // this is exactly why deleted orgs left ghosts behind. Precise (only THIS
  // org's own events, by stored id — no cross-tenant risk), best-effort, and
  // bounded so a huge org can't blow the cron's time budget. The weekly
  // gcal-prune cron is the backstop for anything left, but only while the org
  // still has a connection, so we do the bulk of the work here.
  try {
    const CAL_CLEAN_CAP = 500;
    const { data: orgEvents } = (await db
      .from("bookings")
      .select("google_calendar_event_id")
      .eq("organization_id", orgId)
      .not("google_calendar_event_id", "is", null)
      .limit(CAL_CLEAN_CAP)) as unknown as {
      data: Array<{ google_calendar_event_id: string | null }> | null;
    };
    const orgEventIds = (orgEvents ?? [])
      .map((r) => r.google_calendar_event_id)
      .filter((id): id is string => Boolean(id));
    if (orgEventIds.length > 0) {
      const { deleteCalendarEvent } = await import("@/lib/google-calendar");
      let cleaned = 0;
      for (const evId of orgEventIds) {
        try {
          await deleteCalendarEvent(orgId, evId);
          cleaned++;
        } catch {
          /* best-effort — a stranded event is not worth aborting the purge */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log(
        `[tenant-purge] cleaned ${cleaned}/${orgEventIds.length} org calendar event(s) for org ${orgId}`,
      );
    }

    // This mapping table has no organization_id — it's org-scoped only through
    // its booking. Filter via an inner join on the parent booking's org.
    const { data: memberEvents } = (await db
      .from("booking_member_calendar_events")
      .select("membership_id, google_calendar_event_id, bookings!inner(organization_id)")
      .eq("bookings.organization_id" as never, orgId as never)
      .not("google_calendar_event_id", "is", null)
      .limit(CAL_CLEAN_CAP)) as unknown as {
      data: Array<{
        membership_id: string;
        google_calendar_event_id: string | null;
      }> | null;
    };
    const memberRows = (memberEvents ?? []).filter(
      (m) => m.google_calendar_event_id,
    );
    if (memberRows.length > 0) {
      const { deleteMemberCalendarEventById } = await import(
        "@/lib/google-calendar"
      );
      let cleaned = 0;
      for (const m of memberRows) {
        try {
          await deleteMemberCalendarEventById(
            m.membership_id,
            m.google_calendar_event_id!,
          );
          cleaned++;
        } catch {
          /* best-effort */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log(
        `[tenant-purge] cleaned ${cleaned}/${memberRows.length} member calendar event(s) for org ${orgId}`,
      );
    }
  } catch (err) {
    console.error(
      `[tenant-purge] calendar cleanup failed for org ${orgId}:`,
      err,
    );
  }

  // Delete in an order that respects FK constraints. The schema uses ON
  // DELETE CASCADE almost everywhere, so the dependency graph is loose,
  // but we still delete children before parents to avoid any accidental
  // constraint surprises on future migrations.
  const DELETE_ORDER: readonly string[] = [
    // Booking-scoped children first (cascade on booking_id)
    "booking_checklist_items",
    "booking_member_calendar_events",
    "booking_assignees",
    "job_photos",
    // Conversation / messaging
    "chat_messages",
    "chat_thread_members",
    "chat_threads",
    // Money + invoicing
    "invoice_payments",
    "invoice_line_items",
    "invoices",
    "invoice_series",
    "promo_redemptions",
    "promo_codes",
    "estimate_line_items",
    "estimates",
    "bonuses",
    "bonus_rules",
    "reviews",
    "time_entries",
    // Payroll (items reference runs)
    "payroll_items",
    "payroll_runs",
    "pto_requests",
    "pto_balances",
    // Inventory + training
    "inventory_log",
    "inventory_items",
    "training_assignments",
    "training_steps",
    "training_modules",
    // Checklists templates
    "checklist_template_items",
    "checklist_templates",
    // Availability
    "availability_overrides",
    "availability_slots",
    // Tasks + feed + contracts
    "tasks",
    "feed_posts",
    "contract_documents",
    "contracts",
    // Booking requests + bookings + series
    "booking_requests",
    "bookings",
    "booking_series",
    "packages",
    // Job offers
    "job_offer_claims",
    "job_offer_dispatches",
    "job_offers",
    "freelancer_contacts",
    "clients",
    // Misc per-org
    "scheduler_views",
    "notifications",
    "push_subscriptions",
    "webhook_deliveries",
    "webhook_subscriptions",
    "webhooks",
    "integration_events",
    "integration_connections",
    "invitations",
    "audit_log",
    // Memberships last (other tables reference it)
    "membership_admin_data",
    "memberships",
    "subscriptions",
  ];

  for (const tableName of DELETE_ORDER) {
    const { data, error } = await db
      .from(tableName as never)
      .delete()
      .eq("organization_id" as never, orgId as never)
      .select("id");
    if (error) {
      console.error(`[tenant-purge] ${tableName} failed:`, error.message);
      tableCounts[tableName] = 0;
      continue;
    }
    tableCounts[tableName] = data?.length ?? 0;
  }

  // Wipe storage files. Buckets that hold org-scoped files put the org id
  // as the first path segment (e.g. `org-assets/<orgId>/logo.png`,
  // `contract-docs/<orgId>/...`, `job-photos/<orgId>/<bookingId>/...`).
  // This matches every upload path in the app today. Any file not under
  // an `<orgId>/` prefix is left alone.
  //
  // job-photos is recursive (org/booking/photo.ext) so we walk one level
  // deeper. Other buckets currently store files directly under <orgId>/
  // but we also recurse for safety in case a future upload nests them.
  let storageFilesRemoved = 0;
  const buckets = [
    "org-assets",
    "contract-docs",
    "estimate-pdfs",
    "job-photos",
  ];

  async function purgeBucketPrefix(
    bucket: string,
    prefix: string,
  ): Promise<number> {
    let removed = 0;
    try {
      // Paginate through ALL entries under this prefix. Supabase Storage's
      // .list() caps at 1000 per call; without an offset loop, orgs with
      // more than 1000 photos in a single folder leaked files into the
      // bucket after the purge — GDPR exposure.
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: listed } = await db.storage
          .from(bucket)
          .list(prefix, { limit: PAGE, offset });
        if (!listed || listed.length === 0) break;

        const files: string[] = [];
        for (const entry of listed) {
          // Folder-like entries have id === null in Supabase Storage's
          // listing. Recurse one level into them so nested per-booking
          // photo dirs get cleaned out instead of left orphaned.
          const isFolder = (entry as { id: string | null }).id === null;
          const path = `${prefix}/${entry.name}`;
          if (isFolder) {
            removed += await purgeBucketPrefix(bucket, path);
          } else {
            files.push(path);
          }
        }

        if (files.length > 0) {
          const { error: rmErr } = await db.storage.from(bucket).remove(files);
          if (rmErr) {
            console.error(
              `[tenant-purge] storage ${bucket} remove failed:`,
              rmErr.message,
            );
          } else {
            removed += files.length;
          }
        }

        if (listed.length < PAGE) break;
        offset += PAGE;
        // Hard safety cap — log loudly so we notice when an org has
        // genuinely huge bucket contents that should be batched
        // differently.
        if (offset >= 100_000) {
          console.warn(
            `[tenant-purge] hit 100k offset cap on ${bucket}/${prefix} — remaining files NOT purged.`,
          );
          break;
        }
      }
    } catch (err) {
      console.error(`[tenant-purge] storage ${bucket} exception:`, err);
    }
    return removed;
  }

  for (const bucket of buckets) {
    storageFilesRemoved += await purgeBucketPrefix(bucket, orgId);
  }

  // Tombstone the org row itself. Keep the id to prevent reuse; blank the
  // identifying fields so no PII lingers on the tombstone.
  await db
    .from("organizations")
    .update({
      deleted_at: new Date().toISOString(),
      name: "[deleted]",
      slug: `deleted-${orgId.slice(0, 8)}-${Date.now()}`,
      sender_email: null,
      sender_email_verified_at: null,
      sender_email_token: null,
      brand_color: null,
      logo_url: null,
      stripe_account_id: null,
      stripe_customer_id: null,
    } as never)
    .eq("id", orgId);

  // Right-to-erasure: remove auth identities whose LAST membership was in this
  // org. A person can belong to multiple orgs, so only delete those with no
  // remaining membership anywhere. Best-effort — a lingering auth row is not
  // worth failing the whole purge over.
  let authUsersDeleted = 0;
  for (const profileId of memberProfileIds) {
    try {
      const { count } = await db
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profileId);
      if ((count ?? 0) > 0) continue; // still a member elsewhere — keep them
      const { error: authErr } = await db.auth.admin.deleteUser(profileId);
      if (authErr) {
        console.error(
          `[tenant-purge] auth user delete failed for ${profileId}:`,
          authErr.message,
        );
        continue;
      }
      authUsersDeleted++;
      // Best-effort profile-row removal in case the auth cascade doesn't reach it.
      await db.from("profiles").delete().eq("id" as never, profileId as never);
    } catch (err) {
      console.error(`[tenant-purge] auth cleanup error for ${profileId}:`, err);
    }
  }
  if (authUsersDeleted > 0) {
    console.log(
      `[tenant-purge] erased ${authUsersDeleted} orphaned auth identity(ies) for org ${orgId}`,
    );
  }

  return { tables: tableCounts, storageFilesRemoved, authUsersDeleted };
}

/**
 * Find every org whose 30-day grace window has elapsed and purge them.
 * Returns the list of purged org ids + per-org counts for the cron log.
 */
export async function purgeExpiredOrgs(): Promise<{
  purgedOrgIds: string[];
  results: Record<string, Awaited<ReturnType<typeof purgeOrgData>>>;
}> {
  const db = createSupabaseAdminClient();
  const cutoff = new Date(
    Date.now() - DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: due } = await db
    .from("organizations")
    .select("id")
    .is("deleted_at", null)
    .not("deletion_scheduled_at", "is", null)
    .lt("deletion_scheduled_at", cutoff);

  const orgIds = (due ?? []).map((r) => (r as { id: string }).id);
  const results: Record<string, Awaited<ReturnType<typeof purgeOrgData>>> = {};

  for (const orgId of orgIds) {
    try {
      results[orgId] = await purgeOrgData(orgId);
    } catch (err) {
      console.error(`[tenant-purge] org ${orgId} failed:`, err);
    }
  }

  return { purgedOrgIds: orgIds, results };
}
