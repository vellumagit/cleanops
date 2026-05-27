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

  return {
    exported_at: new Date().toISOString(),
    organization: org as Record<string, unknown> | null,
    tables,
    counts,
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
): Promise<{ tables: Record<string, number>; storageFilesRemoved: number }> {
  const db = createSupabaseAdminClient();
  const tableCounts: Record<string, number> = {};

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
      const { data: listed } = await db.storage
        .from(bucket)
        .list(prefix, { limit: 1000 });
      if (!listed || listed.length === 0) return 0;

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

  return { tables: tableCounts, storageFilesRemoved };
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
