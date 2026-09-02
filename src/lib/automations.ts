/**
 * Internal automations — fire-and-forget side effects that make the
 * platform feel alive. Every function here swallows errors so it
 * can never break the primary action.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone } from "@/lib/log-redact";
import { resolveClientNotify } from "@/lib/notification-gate";
import { sendPushToMembership, sendPushToOrgAdmins } from "@/lib/push";
import { notify } from "@/lib/notify";
import type { CurrencyCode } from "@/lib/format";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import { localInputToUtcIso } from "@/lib/validators/common";
import type { Database } from "@/lib/supabase/types";

type ServiceTypeEnum = Database["public"]["Enums"]["service_type"];
type BonusInsert = Database["public"]["Tables"]["bonuses"]["Insert"];

const admin = () => createSupabaseAdminClient();

/**
 * Check whether a named automation is enabled for an org.
 *
 * Precedence:
 *   1. MASTER SWITCH — organizations.automations_enabled. When false, NOTHING
 *      fires, whatever the per-key settings say. New orgs start false, so a
 *      fresh account is completely silent until the owner opts in.
 *   2. Per-key setting in organizations.automation_settings. Automations are
 *      opt-in: a key with no explicit setting is OFF.
 *
 * On DB read failure we fail CLOSED (return false) rather than falling back to
 * a default — under an opt-in policy, a transient DB hiccup must never
 * surprise-send on behalf of an org that never enabled anything.
 */
async function isAutomationEnabled(
  organizationId: string,
  key: string,
): Promise<boolean> {
  try {
    const { data } = (await admin()
      .from("organizations")
      .select("automation_settings, automations_enabled")
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: {
        automation_settings: Record<
          string,
          { enabled?: boolean } | null
        > | null;
        automations_enabled: boolean | null;
      } | null;
    };
    if (!data) return false;
    // Master switch off → hard stop.
    if (data.automations_enabled !== true) return false;
    // Unified two-flow model: the org toggle always gates the message type
    // (client flow AND internal flow alike); each client's own preferences
    // then gate delivery downstream via resolveClientNotify. The old
    // per-client routing mode that bypassed org toggles is retired — orgs
    // that used it were grandfathered by migration (client-facing keys
    // enabled + house default "none"), so behavior is unchanged.
    return resolveAutomationEnabled(
      (data.automation_settings as Record<
        string,
        { enabled?: boolean } | undefined
      > | null) ?? null,
      key,
    );
  } catch {
    return false;
  }
}

/**
 * Public alias for route handlers (e.g. the unfilled-shifts cron) that need
 * the same master-switch + per-key gate the in-lib automations use.
 */
export const isAutomationEnabledForOrg = isAutomationEnabled;

// ─────────────────────────────────────────────────────────────────
// Helper: fetch all owner/admin recipients for an org
//
// Mirrors the pattern in /api/cron/trial-expiring — pulls owner + admin
// memberships, then their email via the Supabase admin API (emails live
// on auth.users, not profiles). Used by every admin-facing automation.
// ─────────────────────────────────────────────────────────────────

type AdminRecipient = {
  profileId: string;
  fullName: string | null;
  email: string;
};

/**
 * Fetch one membership's email + display name. Used when an event is
 * scoped to a single employee (PTO status, payroll paid, training
 * assigned, certification expiry).
 */
async function getMembershipRecipient(
  membershipId: string,
): Promise<AdminRecipient | null> {
  const db = admin();
  const { data: m } = (await db
    .from("memberships")
    .select("profile_id, organization_id, status")
    .eq("id", membershipId)
    // Deactivated members must not keep receiving schedules, overtime
    // warnings, payroll receipts, PTO or cert emails (audit T9) — they often
    // remain referenced by booking_assignees / payroll_items rows.
    .eq("status", "active")
    .maybeSingle()) as unknown as {
    data: { profile_id: string; organization_id: string } | null;
  };
  if (!m) return null;

  const { data: profile } = (await db
    .from("profiles")
    .select("full_name")
    .eq("id", m.profile_id)
    .maybeSingle()) as unknown as {
    data: { full_name: string | null } | null;
  };

  const userRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${m.profile_id}`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );
  if (!userRes.ok) return null;
  const userData = (await userRes.json()) as { email?: string };
  if (!userData.email) return null;

  return {
    profileId: m.profile_id,
    fullName: profile?.full_name ?? null,
    email: userData.email,
  };
}

async function getOrgAdminRecipients(orgId: string): Promise<AdminRecipient[]> {
  const db = admin();
  const { data: owners } = await db
    .from("memberships")
    .select("profile_id")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin"])
    .eq("status", "active");

  if (!owners || owners.length === 0) return [];

  const recipients: AdminRecipient[] = [];
  for (const o of owners as Array<{ profile_id: string }>) {
    const { data: profile } = (await db
      .from("profiles")
      .select("full_name")
      .eq("id", o.profile_id)
      .maybeSingle()) as unknown as {
      data: { full_name: string | null } | null;
    };

    // Email lives on auth.users — pull via the admin API.
    const userRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${o.profile_id}`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
      },
    );
    if (!userRes.ok) continue;
    const userData = (await userRes.json()) as { email?: string };
    if (!userData.email) continue;

    recipients.push({
      profileId: o.profile_id,
      fullName: profile?.full_name ?? null,
      email: userData.email,
    });
  }

  return recipients;
}

/**
 * In-app + push alert to an org's owners/admins ONLY. Thin wrapper over the
 * notify() primitive (audience: 'org-admins') kept for call-site brevity.
 */
async function notifyOrgAdmins(
  orgId: string,
  payload: { title: string; body: string; href: string },
): Promise<void> {
  await notify({ audience: "org-admins", organizationId: orgId, ...payload });
}

// ─────────────────────────────────────────────────────────────────
// 1. Auto-generate a draft invoice when a job is completed
// ─────────────────────────────────────────────────────────────────

/**
 * Result shape so callers that want to surface errors to the user
 * (e.g. the "Generate invoice now" button) can see what happened.
 * The legacy fire-and-forget pattern still works — callers can
 * ignore the return.
 */
export type AutoInvoiceResult =
  | { ok: true; invoiceId: string; number: string | null }
  | { ok: false; reason: string };

export async function autoInvoiceOnJobComplete(
  bookingId: string,
  /** When true, skip the isAutomationEnabled gate. Used by the
   *  "Generate invoice now" button so the owner can force an invoice
   *  even if the automation toggle is off. */
  options?: { force?: boolean },
): Promise<AutoInvoiceResult> {
  try {
    const db = admin();

    // Fetch the completed booking with client info
    const { data: booking } = (await db
      .from("bookings")
      .select(
        "id, organization_id, client_id, total_cents, service_type, service_type_label, address, duration_minutes, scheduled_at, billing_invoice_id, property:client_properties ( label ), client:clients ( address )",
      )
      .eq("id", bookingId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        client_id: string | null;
        total_cents: number;
        service_type: string;
        service_type_label: string | null;
        address: string | null;
        duration_minutes: number;
        scheduled_at: string;
        billing_invoice_id: string | null;
        client: { address: string | null } | null;
      } | null;
    };

    if (!booking) {
      const reason = `Booking ${bookingId} not found.`;
      console.log(`[auto] autoInvoiceOnJobComplete: ${reason}`);
      return { ok: false, reason };
    }
    if (!booking.client_id) {
      const reason =
        "This booking has no client assigned, so we can't draft an invoice.";
      console.log(
        `[auto] autoInvoiceOnJobComplete: booking ${bookingId} has no client_id`,
      );
      return { ok: false, reason };
    }

    // Billing cadence gate: if the client is on biweekly or monthly billing,
    // the per-job auto-invoice should NOT fire — a consolidated invoice will
    // be generated by the /api/cron/billing-cycle cron on the 1st or 15th.
    // The `force: true` option (used by the "Generate invoice now" button)
    // bypasses this so owners can still create a one-off invoice manually.
    if (!options?.force) {
      const { data: clientMeta } = (await db
        .from("clients")
        .select("billing_cadence")
        .eq("id", booking.client_id)
        .maybeSingle()) as unknown as {
        data: { billing_cadence: string } | null;
      };

      const cadence = clientMeta?.billing_cadence ?? "on_demand";
      if (cadence !== "on_demand") {
        const label =
          cadence === "biweekly"
            ? "biweekly (1st & 15th)"
            : "monthly (1st of month)";
        const reason = `This client is on ${label} billing. A consolidated invoice will be generated automatically on the next billing date.`;
        console.log(
          `[auto] autoInvoiceOnJobComplete: skipping for client ${booking.client_id} — billing_cadence=${cadence}`,
        );
        return { ok: false, reason };
      }
    }

    if (
      !options?.force &&
      !(await isAutomationEnabled(
        booking.organization_id,
        "auto_invoice_on_job_complete",
      ))
    ) {
      const reason =
        "Auto-invoice is disabled for this org in Settings → Automations.";
      console.log(
        `[auto] Auto-invoice paused for org ${booking.organization_id}`,
      );
      return { ok: false, reason };
    }

    // Dedupe: if an invoice already exists for this booking, return
    // its id rather than creating a second. Completing a job twice
    // (or force-clicking the manual button after a successful auto
    // run) should not produce duplicates.
    const { data: existing } = (await db
      .from("invoices")
      .select("id, number")
      .eq("booking_id", booking.id)
      // VOIDED invoices don't count — that work is billable again. The
      // line-item check below already excluded them; this one didn't, so a
      // voided per-job invoice permanently blocked re-invoicing the booking.
      .is("voided_at", null)
      .limit(1)
      .maybeSingle()) as unknown as {
      data: { id: string; number: string | null } | null;
    };

    if (existing) {
      console.log(
        `[auto] autoInvoiceOnJobComplete: booking ${bookingId} already invoiced (${existing.id})`,
      );
      return {
        ok: true,
        invoiceId: existing.id,
        number: existing.number,
      };
    }

    // Consolidated-billing stamp: a booking already swept onto a period
    // invoice carries billing_invoice_id. Older consolidated invoices didn't
    // set line-item booking_ids, so without this check the force path
    // double-billed stamped work (audit M1b). Voided stamps don't count —
    // the void action clears them, but stale pre-fix stamps may linger.
    if (booking.billing_invoice_id) {
      const { data: stampedInv } = (await db
        .from("invoices")
        .select("id, number, voided_at")
        .eq("id", booking.billing_invoice_id)
        .maybeSingle()) as unknown as {
        data: {
          id: string;
          number: string | null;
          voided_at: string | null;
        } | null;
      };
      if (stampedInv && !stampedInv.voided_at) {
        console.log(
          `[auto] autoInvoiceOnJobComplete: booking ${bookingId} already on consolidated invoice ${stampedInv.id}`,
        );
        return {
          ok: true,
          invoiceId: stampedInv.id,
          number: stampedInv.number,
        };
      }
    }

    // Also treat a booking already billed on a consolidated "period" invoice
    // as invoiced. Those record the booking only via invoice_line_items.
    // booking_id (invoices.booking_id is null), so the check above misses them
    // — without this, bulk/force generation double-bills the booking. Void
    // invoices don't count (their work is billable again).
    const { data: liRows } = (await db
      .from("invoice_line_items" as never)
      .select("invoice:invoices!inner ( id, number, voided_at )")
      .eq("booking_id" as never, booking.id as never)
      .is("invoices.voided_at" as never, null as never)
      .limit(1)) as unknown as {
      data: Array<{
        invoice: { id: string; number: string | null } | null;
      }> | null;
    };
    const periodInvoice = liRows?.[0]?.invoice;
    if (periodInvoice) {
      console.log(
        `[auto] autoInvoiceOnJobComplete: booking ${bookingId} already on invoice ${periodInvoice.id} via line items`,
      );
      return {
        ok: true,
        invoiceId: periodInvoice.id,
        number: periodInvoice.number,
      };
    }

    const subtotalCents = booking.total_cents ?? 0;

    // Nothing to bill. A booking with no price (price never filled in, or a
    // non-billable visit like a walkthrough/consultation) must NOT silently
    // auto-generate a $0 invoice — with auto-send enabled that emails the
    // client a $0 bill. `force` still allows a deliberate manual $0 invoice.
    if (!options?.force && subtotalCents <= 0) {
      const reason =
        "This booking has no price set, so there's nothing to invoice. Add a price, then generate the invoice.";
      console.log(
        `[auto] autoInvoiceOnJobComplete: booking ${bookingId} has no price — skipping auto-invoice`,
      );
      return { ok: false, reason };
    }

    // Net 14 from the INVOICE date, not the booking date. Basing the due date
    // on scheduled_at meant a back-dated completion (e.g. the nightly
    // auto-complete cron clearing a backlog of old jobs) produced an invoice
    // whose due date was already in the past — instantly overdue, and the
    // overdue-reminder cron would chase the client the same day.
    const scheduledDate = new Date(booking.scheduled_at);
    const issuedDate = new Date();
    const dueBase = scheduledDate > issuedDate ? scheduledDate : issuedDate;
    const dueDate = new Date(dueBase);
    dueDate.setDate(dueDate.getDate() + 14); // Net 14

    // due_date is a calendar date in the ORG's timezone. A UTC slice put an
    // evening completion on the next day's date, shifting every due date.
    const { getOrgTimezone } = await import("@/lib/org-timezone");
    const { zonedYmd } = await import("@/lib/wall-clock");
    const orgTz = await getOrgTimezone(booking.organization_id);

    // Core insert uses ONLY the long-standing invoice columns. Tax +
    // line items are applied as separate steps below so a missing
    // migration or a new column can't take down the whole path.
    // `number` and `public_token` are auto-assigned by triggers.
    const { data: invoice, error: invErr } = (await db
      .from("invoices")
      .insert({
        organization_id: booking.organization_id,
        client_id: booking.client_id,
        booking_id: booking.id,
        status: "draft",
        amount_cents: subtotalCents,
        due_date: zonedYmd(dueDate, orgTz),
      })
      .select("id, number")
      .single()) as unknown as {
      data: { id: string; number: string | null } | null;
      error: { message: string } | null;
    };

    if (invErr || !invoice) {
      const reason =
        invErr?.message ??
        "The invoice insert returned no row — check Vercel logs.";
      console.error(
        "[auto] autoInvoiceOnJobComplete invoice insert failed:",
        reason,
      );
      return { ok: false, reason };
    }

    // Optional: apply the org's default tax if the columns exist on
    // this deployment AND the org has configured a default. Done as
    // a separate UPDATE so a missing migration leaves us with an
    // untaxed invoice instead of no invoice at all.
    try {
      const { data: orgData } = (await db
        .from("organizations")
        .select("default_tax_rate_bps, default_tax_label")
        .eq("id", booking.organization_id)
        .maybeSingle()) as unknown as {
        data: {
          default_tax_rate_bps: number | null;
          default_tax_label: string | null;
        } | null;
      };
      const rateBps = orgData?.default_tax_rate_bps ?? null;
      if (rateBps && rateBps > 0) {
        const taxAmountCents = Math.round((subtotalCents * rateBps) / 10000);
        const totalCents = subtotalCents + taxAmountCents;
        const { error: taxErr } = await db
          .from("invoices")
          .update({
            amount_cents: totalCents,
            tax_rate_bps: rateBps,
            tax_amount_cents: taxAmountCents,
            tax_label: orgData?.default_tax_label ?? null,
          })
          .eq("id", invoice.id);
        if (taxErr) {
          console.error(
            "[auto] autoInvoiceOnJobComplete tax update failed (invoice still created):",
            taxErr.message,
          );
        }
      }
    } catch (err) {
      console.error(
        "[auto] autoInvoiceOnJobComplete tax step threw (invoice still created):",
        err,
      );
    }

    // Line items live on a separate table, not as a column on
    // invoices. Insert one starter row describing what was done so
    // the owner sees something when they open the invoice.
    const { bookingLineLabel } = await import("@/lib/invoice-line-label");

    const { error: liErr } = await db.from("invoice_line_items").insert({
      organization_id: booking.organization_id,
      invoice_id: invoice.id,
      // Carries the job's date, time window and address — this label is the
      // only description the client ever sees, on both the web invoice and
      // the PDF.
      label: bookingLineLabel({
        serviceLabel:
          booking.service_type_label ?? humanize(booking.service_type),
        scheduledAt: booking.scheduled_at,
        durationMinutes: booking.duration_minutes,
        address: booking.address,
        propertyLabel: (booking as { property?: { label?: string } | null }).property?.label ?? null,
        fallbackAddress: booking.client?.address ?? null,
        tz: orgTz,
      }),
      // Mirrors the billing-cycle path: the line records which job it bills,
      // so the line-item dedup can see this work is already invoiced.
      booking_id: booking.id,
      quantity: 1,
      unit_price_cents: subtotalCents,
      sort_order: 0,
    });

    if (liErr) {
      console.error(
        "[auto] autoInvoiceOnJobComplete line item insert failed (invoice still created):",
        liErr.message,
      );
    }

    // Stamp the booking as billed so the consolidated billing-cycle cron never
    // re-bills this work. Matters when an owner force-generates a per-job
    // invoice for a biweekly/monthly client — without this the 1st/15th cron
    // would invoice the same booking again (a double bill, and with auto-send
    // on, a second email to the client).
    const { error: stampErr } = await db
      .from("bookings")
      .update({ billing_invoice_id: invoice.id } as never)
      .eq("id", booking.id);
    if (stampErr) {
      console.error(
        "[auto] autoInvoiceOnJobComplete billing_invoice_id stamp failed (invoice still created):",
        stampErr.message,
      );
    }

    // Schedule auto-send if the org opted in — but NOT for a force-generated
    // invoice. Clicking "Generate invoice now" is a deliberate act to send it
    // yourself, not to queue it for automatic delivery in 24h.
    if (!options?.force) {
      try {
        const { scheduleAutoSendIfEnabled } =
          await import("@/lib/invoice-send");
        await scheduleAutoSendIfEnabled(invoice.id, booking.organization_id);
      } catch (scheduleErr) {
        console.error(
          "[auto] autoInvoiceOnJobComplete auto-send schedule failed (invoice still drafted):",
          scheduleErr,
        );
      }
    }

    console.log(
      `[auto] Draft invoice ${invoice.number ?? invoice.id} created for booking ${bookingId}`,
    );
    return {
      ok: true,
      invoiceId: invoice.id,
      number: invoice.number,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[auto] autoInvoiceOnJobComplete failed:", err);
    return { ok: false, reason };
  }
}

// ─────────────────────────────────────────────────────────────────
// 2. Notify employee about upcoming job (called by cron)
// ─────────────────────────────────────────────────────────────────

export async function notifyUpcomingJobs() {
  try {
    const db = admin();
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);

    // Find jobs starting in the next hour that are assigned
    const { data: jobs } = (await db
      .from("bookings")
      .select(
        `
        id, organization_id, assigned_to, scheduled_at, service_type, service_type_label, address,
        client:clients ( name )
      `,
      )
      .not("assigned_to", "is", null)
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", in1h.toISOString())
      .in("status", ["pending", "confirmed"])) as unknown as {
      data: Array<{
        id: string;
        organization_id: string;
        assigned_to: string | null;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        address: string | null;
        client: { name: string | null } | null;
      }> | null;
    };

    if (!jobs || jobs.length === 0) return 0;

    // Opt-in gate (audit T2 — this push was ungated). Checked per org since
    // one run spans orgs.
    const gateCache = new Map<string, boolean>();
    const gatedJobs = [];
    for (const j of jobs) {
      const orgId = j.organization_id as string;
      let on = gateCache.get(orgId);
      if (on === undefined) {
        on = await isAutomationEnabled(orgId, "job_starting_soon_push");
        gateCache.set(orgId, on);
      }
      if (on) gatedJobs.push(j);
    }
    if (gatedJobs.length === 0) return 0;

    // Pre-fetch org timezones so notification times display in local time.
    const orgIds = [
      ...new Set(gatedJobs.map((j) => j.organization_id as string)),
    ];
    const { data: orgRows } = (await db
      .from("organizations")
      .select("id, timezone")
      .in("id", orgIds)) as unknown as {
      data: Array<{ id: string; timezone: string | null }> | null;
    };
    const orgTimezones = new Map<string, string>(
      (orgRows ?? []).map((o) => [o.id, o.timezone ?? "America/Edmonton"]),
    );

    // Dedupe — check what's already been notified
    const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: existingNotifs } = (await db
      .from("notifications")
      .select("href")
      .eq("type", "general")
      .gte("created_at", cutoff)
      .limit(500)) as unknown as {
      data: Array<{ href: string | null }> | null;
    };

    const alreadyNotified = new Set(
      (existingNotifs ?? []).map((n) => (n.href ?? "").split("/").pop()),
    );

    const rows = gatedJobs
      .filter((j) => !alreadyNotified.has(j.id))
      .map((j) => {
        const clientName =
          (j.client as unknown as { name: string } | null)?.name ?? "a client";
        const orgTz =
          orgTimezones.get(j.organization_id as string) ?? "America/Edmonton";
        const when = new Date(j.scheduled_at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: orgTz,
        });
        return {
          organization_id: j.organization_id,
          recipient_membership_id: j.assigned_to,
          type: "general" as const,
          title: "Job starting soon",
          body: `${(j as { service_type_label?: string | null }).service_type_label ?? humanize(j.service_type)} for ${clientName} at ${when}${j.address ? ` — ${j.address}` : ""}`,
          href: `/field/jobs/${j.id}`,
        };
      });

    if (rows.length === 0) return 0;

    // Each row targets one assigned cleaner — in-app + push via the primitive.
    await Promise.allSettled(
      rows.map((r) =>
        r.recipient_membership_id
          ? notify({
              audience: "membership",
              membershipId: r.recipient_membership_id,
              organizationId: r.organization_id,
              title: r.title,
              body: r.body,
              href: r.href,
            })
          : Promise.resolve(),
      ),
    );

    return rows.length;
  } catch (err) {
    console.error("[auto] notifyUpcomingJobs failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// 3. Auto-assign training modules to new team members
// ─────────────────────────────────────────────────────────────────
// 4. Auto-create booking when estimate is approved
// ─────────────────────────────────────────────────────────────────

export async function autoBookingOnEstimateApproval(estimateId: string) {
  try {
    const db = admin();

    const { data: estimate } = await db
      .from("estimates")
      .select(
        "id, organization_id, client_id, total_cents, service_description, notes",
      )
      .eq("id", estimateId)
      .maybeSingle();

    if (!estimate) return;

    // Opt-in gate. This was completely ungated (audit B4) — orgs with the
    // master switch OFF still got a booking auto-created on estimate approval,
    // violating the opt-in policy.
    if (
      !(await isAutomationEnabled(
        estimate.organization_id,
        "auto_booking_on_estimate_approval",
      ))
    ) {
      return;
    }

    // Check if a booking already exists linked to this estimate via proper FK
    const { data: existing } = await db
      .from("bookings")
      .select("id")
      .eq("estimate_id", estimateId)
      .limit(1)
      .maybeSingle();

    if (existing) return; // already converted

    // Infer service_type from the estimate's description
    const serviceType = inferServiceType(estimate.service_description);

    // Placeholder slot: tomorrow 9 AM in the ORG's timezone. The previous
    // version used server-local setHours(9) = 09:00 UTC = 3 AM Edmonton, and
    // inserted it as `confirmed` — which the day-before reminder cron then
    // announced to the client as a real 3 AM visit (audit B4).
    const { getOrgTimezone } = await import("@/lib/org-timezone");
    const orgTz = await getOrgTimezone(estimate.organization_id);
    // timeZone matters: without it this formats the SERVER's tomorrow —
    // late evening in the org's timezone, UTC has already rolled over, and
    // the placeholder lands a day late.
    const tomorrowLocalDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: orgTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const { localInputToUtcIso } = await import("@/lib/validators/common");
    const placeholderIso = localInputToUtcIso(
      `${tomorrowLocalDate}T09:00`,
      orgTz,
    );

    const { data: newBooking } = await (db
      .from("bookings")
      .insert({
        organization_id: estimate.organization_id,
        client_id: estimate.client_id,
        estimate_id: estimateId,
        scheduled_at: placeholderIso,
        duration_minutes: 120,
        service_type: serviceType,
        // pending: the manager still has to pick the real date/time. Also
        // pre-stamp the client reminder so the day-before cron can never
        // announce this placeholder to the client — the real reschedule
        // clears the stamp and re-arms it for the actual date.
        status: "pending",
        client_reminder_sent_at: new Date().toISOString(),
        total_cents: estimate.total_cents,
        notes: estimate.service_description ?? "",
      } as never)
      .select("id")
      .single() as unknown as Promise<{
      data: { id: string } | null;
    }>);

    // The fully-automated path (website quote → approve → booking) must
    // convert the lead exactly like a hand-made booking does — this was
    // the one booking-creation site that skipped it, leaving a person
    // with a confirmed job sitting in the Leads column forever.
    if (newBooking) {
      try {
        const { convertLeadOnBooking } = await import("@/lib/lead-conversion");
        await convertLeadOnBooking(estimate.client_id);
      } catch (err) {
        console.error("[auto] estimate-approval lead convert failed:", err);
      }
    }

    const bookingHref = newBooking
      ? `/app/bookings/${newBooking.id}`
      : "/app/bookings";

    // Owner/admin-only — this is an ops task ("set the date, assign a cleaner")
    // and must not broadcast to cleaners.
    const notifPayload = {
      title: "Estimate approved — booking created",
      body: `A new pending ${humanize(serviceType).toLowerCase()} booking was auto-created. Set the date and assign a cleaner.`,
      href: bookingHref,
    };
    await notifyOrgAdmins(estimate.organization_id, notifPayload).catch(
      () => {},
    );

    console.log(`[auto] Booking created from approved estimate ${estimateId}`);
  } catch (err) {
    console.error("[auto] autoBookingOnEstimateApproval failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 5. Alert on stale estimates (called by cron)
// ─────────────────────────────────────────────────────────────────

export async function alertStaleEstimates() {
  try {
    const db = admin();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Find estimates that have been "sent" for 7+ days without a decision
    const { data: stale } = await db
      .from("estimates")
      .select("id, organization_id, total_cents, client:clients ( name )")
      .eq("status", "sent")
      .lte("sent_at", sevenDaysAgo.toISOString())
      .is("decided_at", null);

    if (!stale || stale.length === 0) return 0;

    // Dedupe — don't re-notify for the same estimate within 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const { data: existingNotifs } = (await db
      .from("notifications")
      .select("href")
      .eq("type", "general")
      .gte("created_at", cutoff.toISOString())
      .ilike("title", "%stale estimate%")
      .limit(500)) as unknown as {
      data: Array<{ href: string | null }> | null;
    };

    const alreadyNotified = new Set(
      // href is /app/estimates/{id}/edit — the estimate id is the 2nd-to-last
      // segment. (Previously .pop() returned "edit", so dedup never matched and
      // this alert re-fired on every cron run.)
      (existingNotifs ?? []).map((n) => (n.href ?? "").split("/").at(-2)),
    );

    const toNotify = stale.filter((e) => !alreadyNotified.has(e.id));
    if (toNotify.length === 0) return 0;

    // Group by org and alert each org's owners/admins ONLY. This is financial
    // content (client name + estimate value) and an owner task — it must never
    // broadcast to cleaners, which is what the old sendPushToOrg + null-recipient
    // in-app notification did.
    const byOrg = new Map<string, typeof toNotify>();
    for (const e of toNotify) {
      const list = byOrg.get(e.organization_id) ?? [];
      list.push(e);
      byOrg.set(e.organization_id, list);
    }

    let notified = 0;
    await Promise.allSettled(
      [...byOrg.entries()].map(async ([orgId, ests]) => {
        // Opt-in gate (audit T7 — this alert was ungated and fired for orgs
        // with the master switch off).
        if (!(await isAutomationEnabled(orgId, "stale_estimate_alert"))) {
          return;
        }
        const details = ests.map((e) => {
          const clientName =
            (e.client as unknown as { name: string } | null)?.name ??
            "a client";
          return {
            href: `/app/estimates/${e.id}/edit`,
            body: `Estimate for ${clientName} ($${((e.total_cents ?? 0) / 100).toFixed(0)}) has been pending for 7+ days.`,
          };
        });

        // In-app: one per-estimate admin-only notification (push off — we send
        // a single aggregate push below instead of one per estimate).
        for (const d of details) {
          await notify({
            audience: "org-admins",
            organizationId: orgId,
            title: "Stale estimate — needs follow-up",
            body: d.body,
            href: d.href,
            channels: { push: false },
          });
        }
        notified += details.length;

        // One aggregate push to the org's admins only. Grammar: "1 … needs" /
        // "N … need".
        const n = details.length;
        await sendPushToOrgAdmins(orgId, {
          title: `${n} stale estimate${n > 1 ? "s" : ""} need${n > 1 ? "" : "s"} follow-up`,
          body: details.map((d) => d.body).join(" · "),
          href: "/app/estimates",
        });
      }),
    );

    return notified;
  } catch (err) {
    console.error("[auto] alertStaleEstimates failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. Post system events to the feed
// ─────────────────────────────────────────────────────────────────
// 7a. Send booking confirmation email to client on booking creation
// ─────────────────────────────────────────────────────────────────

export async function sendBookingConfirmation(bookingId: string) {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { bookingConfirmationEmail } = await import("@/lib/email-templates");

    const { data: booking } = (await db
      .from("bookings")
      .select(
        `
        id, organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_label, address,
        confirmation_email_sent_at, confirmation_sms_sent_at,
        client:clients ( name, email, phone )
      `,
      )
      .eq("id", bookingId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        client_id: string | null;
        scheduled_at: string;
        duration_minutes: number;
        service_type: string;
        service_type_label: string | null;
        address: string | null;
        confirmation_email_sent_at: string | null;
        confirmation_sms_sent_at: string | null;
        client: {
          name: string | null;
          email: string | null;
          phone: string | null;
        } | null;
      } | null;
    };

    if (!booking) return;

    const hasEmail = Boolean(booking.client?.email);
    const hasPhone = Boolean(booking.client?.phone);
    // Need at least one channel. (Previously returned unless the client had an
    // EMAIL, which silently dropped the confirmation text for phone-only
    // clients.)
    if (!hasEmail && !hasPhone) return;
    if (!booking.client) return; // narrow for TS (hasEmail/hasPhone imply set)

    // Org info — needed by BOTH channels (fetched once, up front).
    const { data: org } = (await db
      .from("organizations")
      .select("name, brand_color, logo_url, contact_phone, timezone")
      .eq("id", booking.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        name: string;
        brand_color: string | null;
        logo_url: string | null;
        contact_phone: string | null;
        timezone: string | null;
      } | null;
    };

    // Per-client channel preference for BOOKING messages (org default / custom
    // override / do-not-contact + SMS consent). Layered UNDER the per-channel
    // automation toggles below — the toggle says "is this automation on for the
    // org", this says "may we reach THIS client, on which channel".
    const decision = await resolveClientNotify(db, {
      organizationId: booking.organization_id,
      clientId: booking.client_id,
      category: "booking",
      event: "confirmation",
    });

    // ── EMAIL channel — gated by the booking_confirmation_email toggle, the
    //    client's channel preference, and its own dedup stamp. ──
    if (
      hasEmail &&
      decision.email &&
      !booking.confirmation_email_sent_at &&
      (await isAutomationEnabled(
        booking.organization_id,
        "booking_confirmation_email",
      ))
    ) {
      const dateTime = new Date(booking.scheduled_at).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: org?.timezone ?? "America/Edmonton",
      });

      // When the team divides the hours, tell the client when the crew will
      // finish (the visit is shorter with more cleaners).
      const { resolveTeamDivision, crewFinishNote } =
        await import("@/lib/crew-hours");
      const division = await resolveTeamDivision(
        booking.id,
        booking.duration_minutes,
      );
      const crewNote = crewFinishNote(
        division,
        booking.scheduled_at,
        org?.timezone ?? "America/Edmonton",
      );

      const template = bookingConfirmationEmail({
        clientName: booking.client.name ?? "there",
        orgName: org?.name ?? "your service provider",
        serviceName:
          booking.service_type_label ?? humanize(booking.service_type),
        dateTime,
        crewNote,
        address: booking.address ?? "(address to be confirmed)",
        brandColor: org?.brand_color ?? undefined,
        logoUrl: org?.logo_url ?? undefined,
      });

      const sent = await sendOrgEmail(booking.organization_id, {
        to: booking.client.email!,
        toName: booking.client.name ?? undefined,
        ...template,
      });
      if (sent) {
        await db
          .from("bookings")
          .update({ confirmation_email_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
        console.log(
          `[auto] Booking confirmation email sent to ${maskEmail(booking.client.email)}`,
        );
      }
    }

    // ── SMS channel — INDEPENDENT of email. sendOrgSms applies its own gates
    //    (booking_confirmation_sms toggle, client opt-in, cap, CLIENT_SMS_PAUSED,
    //    TWILIO_ENABLED). Previously this was trapped behind the email path, so
    //    an org that enabled only the SMS toggle (email toggle is default-OFF)
    //    never got a confirmation text. Dedup on its own stamp. ──
    if (hasPhone && decision.sms && !booking.confirmation_sms_sent_at) {
      try {
        const { sendOrgSms } = await import("@/lib/sms");
        const { composeBookingConfirmationSms } = await import("@/lib/twilio");
        const { getOrgTimezone } = await import("@/lib/org-timezone");
        const orgTz = await getOrgTimezone(booking.organization_id);
        const smsBody = composeBookingConfirmationSms({
          orgName: org?.name ?? "Sollos",
          serviceType: booking.service_type,
          scheduledAt: booking.scheduled_at,
          contactPhone: org?.contact_phone ?? null,
          tz: orgTz,
        });
        const smsRes = await sendOrgSms(booking.organization_id, {
          to: booking.client.phone!,
          body: smsBody,
          automationKey: "booking_confirmation_sms",
        });
        if (smsRes.ok && smsRes.status === "sent") {
          await db
            .from("bookings")
            .update({
              confirmation_sms_sent_at: new Date().toISOString(),
            } as never)
            .eq("id", booking.id);
        }
      } catch (smsErr) {
        console.error(
          "[auto] sendBookingConfirmation SMS path errored:",
          smsErr,
        );
      }
    }
  } catch (err) {
    console.error("[auto] sendBookingConfirmation failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7b. Email the client when a booking is rescheduled (scheduled_at changed)
// ─────────────────────────────────────────────────────────────────

export async function sendBookingRescheduled(
  bookingId: string,
  oldScheduledAt: string,
) {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { bookingRescheduledEmail } = await import("@/lib/email-templates");

    const { data: booking } = (await db
      .from("bookings")
      .select(
        `
        id, organization_id, client_id, scheduled_at, service_type, service_type_label, address, assigned_to,
        client:clients ( name, email, phone )
      `,
      )
      .eq("id", bookingId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        client_id: string | null;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        address: string | null;
        assigned_to: string | null;
        client: {
          name: string | null;
          email: string | null;
          phone: string | null;
        } | null;
      } | null;
    };

    if (!booking) return;

    const serviceDisplayName =
      booking.service_type_label ?? humanize(booking.service_type);

    // Org row up front — we need the timezone to format times in the client's
    // local wall-clock, not Vercel's UTC clock (which turned noon into "6 PM").
    const { data: org } = (await db
      .from("organizations")
      .select("name, brand_color, logo_url, timezone, contact_phone")
      .eq("id", booking.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        name: string;
        brand_color: string | null;
        logo_url: string | null;
        timezone: string | null;
        contact_phone: string | null;
      } | null;
    };
    const tz = org?.timezone ?? "America/Edmonton";

    // Push the crew first — the field app banner needs to update even if the
    // client email is paused or blocked. Fans out to EVERY assignee
    // (booking_assignees), not just the primary — secondary crew previously
    // showed up at the old time (audit L13).
    {
      const { data: crewRows } = (await db
        .from("booking_assignees")
        .select("membership_id")
        .eq("booking_id", bookingId)) as unknown as {
        data: Array<{ membership_id: string }> | null;
      };
      const crew = new Set<string>(
        (crewRows ?? []).map((r) => r.membership_id),
      );
      if (booking.assigned_to) crew.add(booking.assigned_to);
      if (crew.size > 0) {
        const when = new Date(booking.scheduled_at).toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: tz,
        });
        await Promise.allSettled(
          Array.from(crew).map((membershipId) =>
            notify({
              audience: "membership",
              membershipId,
              organizationId: booking.organization_id,
              title: "Booking rescheduled",
              body: `${serviceDisplayName} moved to ${when}`,
              href: `/field/jobs/${bookingId}`,
            }),
          ),
        );
      }
    }

    if (!booking.client) return;

    // ── Client notice: per-client channel preference (booking category) ──
    // The client's setting (org default / custom / do-not-contact + SMS
    // consent) decides email vs text vs both vs nothing. No cross-channel
    // fallback — if they chose SMS and aren't opted in, we stay silent.
    const decision = await resolveClientNotify(db, {
      organizationId: booking.organization_id,
      clientId: booking.client_id,
      category: "booking",
      event: "rescheduled",
    });

    // SMS channel. sendOrgSms also enforces the booking_rescheduled_sms toggle,
    // opt-in, cap, and TWILIO_ENABLED.
    if (decision.sms && booking.client.phone) {
      try {
        const { sendOrgSms } = await import("@/lib/sms");
        const { composeBookingRescheduledSms } = await import("@/lib/twilio");
        await sendOrgSms(booking.organization_id, {
          to: booking.client.phone,
          body: composeBookingRescheduledSms({
            orgName: org?.name ?? "Sollos",
            scheduledAt: booking.scheduled_at,
            contactPhone: org?.contact_phone ?? null,
            tz,
          }),
          automationKey: "booking_rescheduled_sms",
        });
        console.log(
          `[auto] Booking rescheduled text sent to ${maskPhone(booking.client.phone)}`,
        );
      } catch (smsErr) {
        console.error(
          "[auto] sendBookingRescheduled SMS path errored:",
          smsErr,
        );
      }
    }

    // Email channel — independent (a "both" client gets both). Gated by the
    // client preference AND the booking_rescheduled_email toggle.
    if (
      !decision.email ||
      !booking.client.email ||
      !(await isAutomationEnabled(
        booking.organization_id,
        "booking_rescheduled_email",
      ))
    ) {
      return;
    }

    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      });

    const template = bookingRescheduledEmail({
      clientName: booking.client.name ?? "there",
      orgName: org?.name ?? "your service provider",
      serviceName: serviceDisplayName,
      oldDateTime: fmt(oldScheduledAt),
      newDateTime: fmt(booking.scheduled_at),
      address: booking.address ?? "(address on file)",
      brandColor: org?.brand_color ?? undefined,
      logoUrl: org?.logo_url ?? undefined,
    });

    const sent = await sendOrgEmail(booking.organization_id, {
      to: booking.client.email,
      toName: booking.client.name ?? undefined,
      ...template,
    });

    if (sent) {
      await db
        .from("bookings")
        .update({ rescheduled_email_sent_at: new Date().toISOString() })
        .eq("id", booking.id);
    }

    console.log(
      `[auto] Booking rescheduled email sent to ${maskEmail(booking.client.email)}`,
    );
  } catch (err) {
    console.error("[auto] sendBookingRescheduled failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7f. Push the assigned employee when a booking is cancelled
//
// Prevents the "employee shows up for a job that was cancelled" failure
// mode. Fires in-app notification + push to the full crew. The client-facing
// cancellation notice is 7g (sendBookingCancelledToClient).
// ─────────────────────────────────────────────────────────────────

export async function notifyBookingCancelledToEmployee(bookingId: string) {
  try {
    const db = admin();
    const { data: booking } = (await db
      .from("bookings")
      .select(
        "id, organization_id, assigned_to, scheduled_at, service_type, service_type_label, client:clients ( name )",
      )
      .eq("id", bookingId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        assigned_to: string | null;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        client: { name: string | null } | null;
      } | null;
    };

    if (!booking) return;

    // Full crew, not just the primary — a secondary assignee driving to a
    // cancelled job is exactly the failure this push exists to prevent
    // (audit L13).
    const { data: cancelCrewRows } = (await db
      .from("booking_assignees")
      .select("membership_id")
      .eq("booking_id", bookingId)) as unknown as {
      data: Array<{ membership_id: string }> | null;
    };
    const cancelCrew = new Set<string>(
      (cancelCrewRows ?? []).map((r) => r.membership_id),
    );
    if (booking.assigned_to) cancelCrew.add(booking.assigned_to);
    if (cancelCrew.size === 0) return;

    const { data: orgTzRow } = (await db
      .from("organizations")
      .select("timezone")
      .eq("id", booking.organization_id)
      .maybeSingle()) as unknown as {
      data: { timezone: string | null } | null;
    };

    const when = new Date(booking.scheduled_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: orgTzRow?.timezone ?? "America/Edmonton",
    });
    const serviceDisplay =
      booking.service_type_label ?? humanize(booking.service_type);
    const title = "Job cancelled";
    const body = `${serviceDisplay} for ${booking.client?.name ?? "a client"} on ${when} was cancelled. You don't need to go.`;

    await Promise.allSettled(
      Array.from(cancelCrew).map((membershipId) =>
        notify({
          audience: "membership",
          membershipId,
          organizationId: booking.organization_id,
          title,
          body,
          href: `/field/jobs`,
        }),
      ),
    );

    console.log(`[auto] Cancellation push sent for booking ${bookingId}`);
  } catch (err) {
    console.error("[auto] notifyBookingCancelledToEmployee failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7g. Booking cancelled — email the client (mirror of rescheduled)
// ─────────────────────────────────────────────────────────────────

export async function sendBookingCancelledToClient(bookingId: string) {
  try {
    const db = admin();
    const { sendOrgEmail } = await import("@/lib/email");
    const { bookingCancelledEmail } = await import("@/lib/email-templates");

    const { data: booking } = (await db
      .from("bookings")
      .select(
        `
        id, organization_id, client_id, scheduled_at, service_type, service_type_label, address,
        cancelled_email_sent_at,
        client:clients ( name, email, phone )
      `,
      )
      .eq("id", bookingId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        client_id: string | null;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        address: string | null;
        cancelled_email_sent_at: string | null;
        client: {
          name: string | null;
          email: string | null;
          phone: string | null;
        } | null;
      } | null;
    };

    if (!booking || !booking.client) return;

    // Dedup: the cancellation notice fires ONCE per booking. (Column name
    // predates the SMS channel — it marks "notice sent" whichever channel(s)
    // delivered; a both-preference client gets text + email in that one pass.)
    if (booking.cancelled_email_sent_at) {
      console.log(
        `[auto] Cancellation notice already sent for ${bookingId}, skipping`,
      );
      return;
    }

    const { data: org } = (await db
      .from("organizations")
      .select("name, brand_color, logo_url, timezone, contact_phone")
      .eq("id", booking.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        name: string;
        brand_color: string | null;
        logo_url: string | null;
        timezone: string | null;
        contact_phone: string | null;
      } | null;
    };

    // ── Client notice: per-client channel preference (booking category) ──
    // The client's setting decides email vs text vs both vs nothing. No
    // cross-channel fallback. A "do not contact" client gets no cancellation
    // notice by their own choice — the crew push above is the operational
    // safety net so no one shows up to a cancelled job.
    const decision = await resolveClientNotify(db, {
      organizationId: booking.organization_id,
      clientId: booking.client_id,
      category: "booking",
      event: "cancelled",
    });

    let anySent = false;

    // SMS channel. sendOrgSms also enforces the sms toggle / opt-in / cap.
    if (decision.sms && booking.client.phone) {
      try {
        const { sendOrgSms } = await import("@/lib/sms");
        const { composeBookingCancelledSms } = await import("@/lib/twilio");
        const smsRes = await sendOrgSms(booking.organization_id, {
          to: booking.client.phone,
          body: composeBookingCancelledSms({
            orgName: org?.name ?? "Sollos",
            scheduledAt: booking.scheduled_at,
            contactPhone: org?.contact_phone ?? null,
            tz: org?.timezone ?? "America/Edmonton",
          }),
          automationKey: "booking_cancelled_sms",
        });
        if (smsRes.ok && smsRes.status === "sent") {
          anySent = true;
          console.log(
            `[auto] Booking cancelled text sent to ${maskPhone(booking.client.phone)}`,
          );
        }
      } catch (smsErr) {
        console.error(
          "[auto] sendBookingCancelledToClient SMS path errored:",
          smsErr,
        );
      }
    }

    // Email channel — independent (a "both" client gets both). Gated by the
    // client preference AND the booking_cancelled_email toggle.
    if (
      decision.email &&
      booking.client.email &&
      (await isAutomationEnabled(
        booking.organization_id,
        "booking_cancelled_email",
      ))
    ) {
      const dateTime = new Date(booking.scheduled_at).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: org?.timezone ?? "America/Edmonton",
      });

      const template = bookingCancelledEmail({
        clientName: booking.client.name ?? "there",
        orgName: org?.name ?? "your service provider",
        serviceName:
          booking.service_type_label ?? humanize(booking.service_type),
        dateTime,
        address: booking.address ?? "(address on file)",
        brandColor: org?.brand_color ?? undefined,
        logoUrl: org?.logo_url ?? undefined,
      });

      const sent = await sendOrgEmail(booking.organization_id, {
        to: booking.client.email,
        toName: booking.client.name ?? undefined,
        ...template,
      });
      if (sent) {
        anySent = true;
        console.log(
          `[auto] Booking cancelled email sent to ${maskEmail(booking.client.email)}`,
        );
      }
    }

    // Dedup stamp — mark the cancellation notice sent once either channel lands.
    if (anySent) {
      await db
        .from("bookings")
        .update({ cancelled_email_sent_at: new Date().toISOString() })
        .eq("id", booking.id);
    }
  } catch (err) {
    console.error("[auto] sendBookingCancelledToClient failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 7h. Rebooking prompt — daily cron, emails clients whose last service
// was 14+ days ago and who have no future booking scheduled
// ─────────────────────────────────────────────────────────────────

export async function sendRebookingPrompts(): Promise<{
  considered: number;
  sent: number;
}> {
  const db = admin();
  const { sendOrgEmail } = await import("@/lib/email");
  const { rebookingPromptEmail } = await import("@/lib/email-templates");

  const now = Date.now();
  const fourteenDaysAgo = new Date(
    now - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = new Date(now).toISOString();

  // GATE FIRST (audit G6): resolve which orgs opted in BEFORE scanning
  // clients. Under opt-in most orgs are off, and the old shape scanned every
  // client row in the database daily and ran 3 queries each before checking
  // the org toggle.
  const { data: orgRows } = (await db
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, sender_email, automations_enabled, automation_settings",
    )
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      sender_email: string | null;
      automations_enabled: boolean | null;
      automation_settings: Record<string, { enabled?: boolean }> | null;
    }> | null;
  };
  const { resolveAutomationEnabled } =
    await import("@/lib/automation-defaults");
  const enabledOrgs = new Map<
    string,
    {
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      sender_email: string | null;
    }
  >();
  // Per-org nudge cadence — "same thing for rebooking prompt": the fixed
  // 30-day cap becomes the org's configured gap (monthly / 4x / 2x /
  // yearly), read from the same settings entry as the toggle.
  const { rebookingGapDays } = await import("@/lib/review-cadence");
  const rebookGapByOrg = new Map<string, number>();
  for (const o of orgRows ?? []) {
    if (o.automations_enabled !== true) continue;
    if (
      !resolveAutomationEnabled(o.automation_settings, "rebooking_prompt_email")
    ) {
      continue;
    }
    enabledOrgs.set(o.id, o);
    rebookGapByOrg.set(o.id, rebookingGapDays(o.automation_settings));
  }
  if (enabledOrgs.size === 0) return { considered: 0, sent: 0 };
  const maxRebookGapDays = Math.max(30, ...Array.from(rebookGapByOrg.values()));
  const rebookThreshold = new Date(
    now - maxRebookGapDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  // RECENCY CEILING (audit G6): never prompt someone whose last service is
  // older than this — "it's been 730 days since your last clean" is not a
  // nudge, it's a cold email to a lapsed contact, and it repeated monthly
  // forever. 14d..180d is the actionable window.
  const ceilingIso = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = (await db
    .from("clients")
    .select("id, organization_id, name, email, last_rebook_prompt_at")
    .in("organization_id", Array.from(enabledOrgs.keys()))
    .not("email", "is", null)
    .or(
      `last_rebook_prompt_at.is.null,last_rebook_prompt_at.lt.${rebookThreshold}`,
    )
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      name: string | null;
      email: string | null;
      last_rebook_prompt_at: string | null;
    }> | null;
  };

  if (!candidates || candidates.length === 0) {
    return { considered: 0, sent: 0 };
  }

  let sent = 0;
  const considered = candidates.length;

  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();
  // Reply-to fallback per org: sender_email, else the first owner/admin's
  // real address — the CTA is a mailto, and pointing it at noreply@ was a
  // dead end for the client (audit L1).
  const replyToCache = new Map<string, string>();

  for (const client of candidates) {
    if (!client.email) continue;

    // The query used the WIDEST gap across orgs; enforce this org's own.
    const gapDays = rebookGapByOrg.get(client.organization_id) ?? 30;
    if (
      client.last_rebook_prompt_at &&
      Date.parse(client.last_rebook_prompt_at) >
        now - gapDays * 24 * 60 * 60 * 1000
    ) {
      continue;
    }

    // Check most recent completed booking for this client.
    const { data: lastCompleted } = (await db
      .from("bookings")
      .select("scheduled_at")
      .eq("client_id", client.id)
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as {
      data: { scheduled_at: string } | null;
    };

    // Window: completed 14+ days ago, but not lapsed beyond the ceiling.
    if (!lastCompleted || lastCompleted.scheduled_at > fourteenDaysAgo) {
      continue;
    }
    if (lastCompleted.scheduled_at < ceilingIso) continue;

    // Must have NO future booking.
    const { count: futureCount } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", nowIso);

    if ((futureCount ?? 0) > 0) continue;

    // Client notification preference (growth category) — rebooking nudges are
    // marketing-ish, so a do-not-contact or growth-off client never gets one.
    const decision = await resolveClientNotify(db, {
      organizationId: client.organization_id,
      clientId: client.id,
      category: "growth",
      event: "rebooking_prompt",
      orgDefaultCache,
    });
    if (!decision.email) continue;

    const org = enabledOrgs.get(client.organization_id);
    if (!org) continue;

    const daysSince = Math.round(
      (now - new Date(lastCompleted.scheduled_at).getTime()) /
        (24 * 60 * 60 * 1000),
    );

    let replyTo = replyToCache.get(client.organization_id);
    if (!replyTo) {
      replyTo = org.sender_email ?? "";
      if (!replyTo) {
        const admins = await getOrgAdminRecipients(client.organization_id);
        replyTo =
          admins[0]?.email ?? process.env.EMAIL_FROM ?? "noreply@sollos3.com";
      }
      replyToCache.set(client.organization_id, replyTo);
    }

    // Marketing unsubscribe (CASL, audit L2): reuse the client's GBP
    // unsubscribe token as the general marketing token — mint lazily.
    let unsubToken: string | null = null;
    try {
      const { data: tokRow } = (await db
        .from("clients")
        .select("gbp_unsubscribe_token")
        .eq("id", client.id)
        .maybeSingle()) as unknown as {
        data: { gbp_unsubscribe_token: string | null } | null;
      };
      unsubToken = tokRow?.gbp_unsubscribe_token ?? null;
      if (!unsubToken) {
        const { generateClaimToken } = await import("@/lib/claim-token");
        unsubToken = generateClaimToken(24);
        await db
          .from("clients")
          .update({ gbp_unsubscribe_token: unsubToken } as never)
          .eq("id", client.id);
      }
    } catch {
      unsubToken = null; // best-effort — email still goes out without the link
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const unsubscribeUrl = unsubToken
      ? `${siteUrl}/api/u/m/${unsubToken}`
      : undefined;

    const template = rebookingPromptEmail({
      clientName: client.name ?? "there",
      orgName: org.name,
      daysSinceLastService: daysSince,
      bookingUrl: `mailto:${replyTo}`,
      replyToAddress: replyTo,
      brandColor: org.brand_color ?? undefined,
      logoUrl: org.logo_url ?? undefined,
      unsubscribeUrl,
    });

    const ok = await sendOrgEmail(client.organization_id, {
      to: client.email,
      toName: client.name ?? undefined,
      ...template,
      ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
    });

    if (ok) {
      await db
        .from("clients")
        .update({ last_rebook_prompt_at: new Date().toISOString() })
        .eq("id", client.id);
      sent += 1;
      console.log(`[auto] Rebooking prompt sent to ${maskEmail(client.email)}`);
    }
  }

  return { considered, sent };
}

// ─────────────────────────────────────────────────────────────────
// 7i. Estimate follow-up cron — emails client at 7d + 14d after send
// ─────────────────────────────────────────────────────────────────

export async function sendStaleEstimateFollowups(): Promise<{
  sent7d: number;
  sent14d: number;
}> {
  const db = admin();
  const { sendOrgEmail } = await import("@/lib/email");
  const { estimateFollowupEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(
    now - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Pull every estimate that's still in 'sent' status + has a sent_at
  // old enough to qualify for at least the 7-day follow-up. We'll decide
  // per-row which stage applies.
  const { data: candidates } = (await db
    .from("estimates")
    .select(
      `id, organization_id, client_id, total_cents, sent_at, public_token,
       client_followup_7d_sent_at, client_followup_14d_sent_at,
       client:clients ( name, email )`,
    )
    .eq("status", "sent")
    .lte("sent_at", sevenDaysAgo)
    .is("decided_at", null)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      client_id: string | null;
      total_cents: number;
      sent_at: string;
      public_token: string | null;
      client_followup_7d_sent_at: string | null;
      client_followup_14d_sent_at: string | null;
      client: { name: string | null; email: string | null } | null;
    }> | null;
  };

  if (!candidates || candidates.length === 0) {
    return { sent7d: 0, sent14d: 0 };
  }

  let sent7d = 0;
  let sent14d = 0;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  // Cache per-org lookups.
  type OrgInfo = {
    name: string;
    brand_color: string | null;
    logo_url: string | null;
    enabled: boolean;
    currency: "CAD" | "USD";
  };
  const orgCache = new Map<string, OrgInfo | null>();
  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();

  for (const est of candidates) {
    if (!est.client?.email || !est.public_token) continue;

    // Client notification preference (growth category).
    const decision = await resolveClientNotify(db, {
      organizationId: est.organization_id,
      clientId: est.client_id,
      category: "growth",
      event: "estimate_followup",
      orgDefaultCache,
    });
    if (!decision.email) continue;

    const isPast14 = est.sent_at <= fourteenDaysAgo;
    const stage: "day7" | "day14" = isPast14 ? "day14" : "day7";

    // Dedup: skip if we've already sent the applicable stage.
    if (stage === "day14" && est.client_followup_14d_sent_at) continue;
    if (stage === "day7" && est.client_followup_7d_sent_at) continue;

    // Also don't double-send 7d if we're already past 14d and the 7d row
    // is stamped — keep the progression orderly.
    if (stage === "day14" && !est.client_followup_7d_sent_at) {
      // We skipped the 7d window (probably because this cron wasn't
      // running yet). Skip straight to 14d; that's the more urgent one.
    }

    let org = orgCache.get(est.organization_id);
    if (org === undefined) {
      const enabled = await isAutomationEnabled(
        est.organization_id,
        "estimate_followup_email",
      );
      const { data: orgData } = (await db
        .from("organizations")
        .select("name, brand_color, logo_url")
        .eq("id", est.organization_id)
        .maybeSingle()) as unknown as {
        data: {
          name: string;
          brand_color: string | null;
          logo_url: string | null;
        } | null;
      };
      const currency = await getOrgCurrency(est.organization_id);
      org = orgData ? { ...orgData, enabled, currency } : null;
      orgCache.set(est.organization_id, org);
    }
    if (!org || !org.enabled) continue;

    // CLAIM-FIRST CAS (audit G3): stamp the stage before sending, guarded on
    // "still sent, still undecided, stage not yet stamped". Zero rows means a
    // concurrent run beat us OR the owner/client decided while this batch was
    // in flight — either way, don't email "still thinking it over?" to someone
    // who just approved. Rolled back if the send fails so the stage retries.
    const stamp = new Date().toISOString();
    const stampCol =
      stage === "day14"
        ? "client_followup_14d_sent_at"
        : "client_followup_7d_sent_at";
    const { data: claimed } = (await db
      .from("estimates")
      .update({ [stampCol]: stamp })
      .eq("id", est.id)
      .eq("status", "sent")
      .is("decided_at", null)
      .is(stampCol, null)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    if (!claimed || claimed.length === 0) continue;

    const template = estimateFollowupEmail({
      clientName: est.client.name ?? "there",
      orgName: org.name,
      amountFormatted: formatCurrencyCents(est.total_cents, org.currency),
      publicUrl: `${siteUrl}/e/${est.public_token}`,
      stage,
      brandColor: org.brand_color ?? undefined,
      logoUrl: org.logo_url ?? undefined,
    });

    const ok = await sendOrgEmail(est.organization_id, {
      to: est.client.email,
      toName: est.client.name ?? undefined,
      ...template,
    });

    if (ok) {
      if (stage === "day14") sent14d += 1;
      else sent7d += 1;
      console.log(
        `[auto] Estimate ${stage} follow-up sent for ${est.id} to ${maskEmail(est.client.email)}`,
      );
    } else {
      // Send failed — release the claim so this stage retries next run.
      await db
        .from("estimates")
        .update({ [stampCol]: null })
        .eq("id", est.id)
        .eq(stampCol, stamp);
    }
  }

  return { sent7d, sent14d };
}

// ─────────────────────────────────────────────────────────────────
// 7c. Overdue invoice reminder cron — runs daily, sends once per 7 days per invoice
// ─────────────────────────────────────────────────────────────────

export async function sendOverdueReminders(): Promise<{
  considered: number;
  sent: number;
  skipped: number;
}> {
  const db = admin();
  const { sendOrgEmail } = await import("@/lib/email");
  const { invoiceOverdueReminderEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  // FIRST: flip past-due `sent` invoices to `overdue`. Nothing else in the
  // system does this on due-date passage — the payment-ledger trigger only
  // recomputes status when a payment row changes, so an invoice the client
  // simply never pays stayed `sent` forever and neither this reminder nor
  // auto-void ever saw it (audit C3). UTC date compare: a few hours of
  // boundary skew vs org-local is acceptable for "overdue".
  try {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const { data: flipped } = (await db
      .from("invoices")
      .update({ status: "overdue" })
      .eq("status", "sent")
      .lt("due_date", todayUtc)
      .is("paid_at", null)
      .is("voided_at", null)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    if (flipped && flipped.length > 0) {
      console.log(`[auto] flipped ${flipped.length} invoice(s) sent → overdue`);
    }
  } catch (flipErr) {
    console.error("[auto] sent→overdue flip failed:", flipErr);
  }

  // Find every overdue, unpaid invoice whose last reminder is either null
  // or older than 7 days. Uses the partial index from migration
  // 20260418030000_invoice_overdue_reminders.sql.
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: candidates } = (await db
    .from("invoices")
    .select(
      `
      id, number, organization_id, client_id, amount_cents, due_date, public_token,
      overdue_reminder_sent_at,
      client:clients ( name, email )
    `,
    )
    .eq("status", "overdue")
    .is("paid_at", null)
    .or(
      `overdue_reminder_sent_at.is.null,overdue_reminder_sent_at.lt.${sevenDaysAgo}`,
    )) as unknown as {
    data: Array<{
      id: string;
      number: string | null;
      organization_id: string;
      client_id: string | null;
      amount_cents: number;
      due_date: string | null;
      public_token: string | null;
      overdue_reminder_sent_at: string | null;
      client: { name: string | null; email: string | null } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let sent = 0;
  let skipped = 0;

  if (!candidates || candidates.length === 0) {
    return { considered, sent, skipped };
  }

  // Cache org lookups — many invoices share the same org.
  const orgCache = new Map<
    string,
    {
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      enabled: boolean;
      currency: CurrencyCode;
    } | null
  >();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();

  for (const inv of candidates) {
    if (!inv.due_date) {
      skipped += 1;
      continue;
    }

    // Client notification preference (billing category) — a do-not-contact or
    // billing-off client is never chased about an overdue invoice. Billing is
    // a two-channel category: email, text (for opted-in clients), or both.
    const decision = await resolveClientNotify(db, {
      organizationId: inv.organization_id,
      clientId: inv.client_id,
      category: "billing",
      event: "overdue_reminder",
      orgDefaultCache,
    });
    const canEmail = decision.email && Boolean(inv.client?.email);
    const canSms = decision.sms && Boolean(decision.clientPhone);
    if (!canEmail && !canSms) {
      skipped += 1;
      continue;
    }

    let cached = orgCache.get(inv.organization_id);
    if (cached === undefined) {
      const enabled = await isAutomationEnabled(
        inv.organization_id,
        "invoice_overdue_reminder",
      );
      const { data: orgData } = (await db
        .from("organizations")
        .select("name, brand_color, logo_url")
        .eq("id", inv.organization_id)
        .maybeSingle()) as unknown as {
        data: {
          name: string;
          brand_color: string | null;
          logo_url: string | null;
        } | null;
      };
      const currency = await getOrgCurrency(inv.organization_id);
      cached = orgData ? { ...orgData, enabled, currency } : null;
      orgCache.set(inv.organization_id, cached);
    }

    if (!cached) {
      skipped += 1;
      continue;
    }

    if (!cached.enabled) {
      console.log(
        `[auto] Overdue reminder paused for org ${inv.organization_id}`,
      );
      skipped += 1;
      continue;
    }

    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.max(
      1,
      Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const invoiceNumber = inv.number ?? inv.id.slice(0, 8).toUpperCase();
    const amountFormatted = formatCurrencyCents(
      inv.amount_cents,
      cached.currency,
    );
    const publicUrl = inv.public_token
      ? `${siteUrl}/i/${inv.public_token}`
      : siteUrl;

    // Send first, stamp second — if the send throws we'll retry tomorrow.
    let emailOk = false;
    if (canEmail) {
      const template = invoiceOverdueReminderEmail({
        clientName: inv.client!.name ?? "there",
        invoiceNumber,
        amountFormatted,
        // due_date is a DATE column — pinned, not zoned. See invoice-send.ts.
        dueDate: dueDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
        daysOverdue,
        publicUrl,
        orgName: cached.name,
        brandColor: cached.brand_color ?? undefined,
        logoUrl: cached.logo_url ?? undefined,
      });
      emailOk = await sendOrgEmail(inv.organization_id, {
        to: inv.client!.email!,
        toName: inv.client!.name ?? undefined,
        ...template,
      });
    }

    // SMS channel — independent of email; sendOrgSms applies its own gates
    // (per-key toggle, opt-in, cap, TWILIO_ENABLED).
    let smsOk = false;
    if (canSms) {
      try {
        const { sendOrgSms } = await import("@/lib/sms");
        const { composeOverdueReminderSms } = await import("@/lib/twilio");
        const smsRes = await sendOrgSms(inv.organization_id, {
          to: decision.clientPhone!,
          body: composeOverdueReminderSms({
            orgName: cached.name,
            invoiceNumber,
            amountFormatted,
            publicUrl,
          }),
          automationKey: "invoice_overdue_reminder",
        });
        smsOk = smsRes.ok && smsRes.status === "sent";
      } catch (smsErr) {
        console.error(
          "[auto] overdue reminder SMS path errored:",
          inv.id,
          smsErr,
        );
      }
    }

    if (emailOk || smsOk) {
      await db
        .from("invoices")
        .update({ overdue_reminder_sent_at: new Date().toISOString() })
        .eq("id", inv.id);
      sent += 1;
      console.log(
        `[auto] Overdue reminder sent for invoice ${inv.id} (${[emailOk && "email", smsOk && "sms"].filter(Boolean).join("+")})`,
      );
    } else {
      skipped += 1;
    }
  }

  return { considered, sent, skipped };
}

// ─────────────────────────────────────────────────────────────────
// 7c-2. Internal review request (DAILY cron, 10:00 UTC)
//
// Fires once per completed booking. Originally planned as hourly so
// the "2h after job end" delay would feel snappy, but Vercel Hobby
// only allows daily crons — upgrade to Pro to tighten the cadence.
// In practice the cron picks up everything completed in the last
// 30 days that hasn't been review-requested yet, so the delay is
// effectively "between (delay) and ~24h after job end."
//
// Org-configurable timing via organizations.internal_review_delay_minutes
// (default 120 min, lower bound is just defensive — daily cadence
// makes anything under 24h academic). Emails the client a Sollos-
// hosted review link (/review/<token>) capturing a 1-5 star rating +
// comment scoped to the employee. Powers the dashboard rating, per-
// employee scores, and bonus rules.
//
// The Google review ask is a SEPARATE track — see
// sendGbpReviewRequests() below. That one fires only on a client's
// first job and is one-and-done with monthly reminders.
//
// Gated:
//   1. Platform kill switch (CLIENT_EMAILS_PAUSED)
//   2. Per-org toggle `review_request_after_completion`
//   3. Per-org timing (internal_review_delay_minutes)
//   4. Dedup by bookings.review_request_sent_at (sent at most once per booking)
//   5. Client must have an email address
// ─────────────────────────────────────────────────────────────────

export async function sendBookingReviewRequests(): Promise<{
  considered: number;
  sent: number;
  skipped: number;
}> {
  const db = admin();
  const { sendOrgEmail, isClientEmailPaused } = await import("@/lib/email");
  const { reviewRequestEmail } = await import("@/lib/email-templates");
  const { generateClaimToken } = await import("@/lib/claim-token");

  if (isClientEmailPaused()) {
    console.log(
      "[auto] sendBookingReviewRequests: CLIENT_EMAILS_PAUSED — skipping",
    );
    return { considered: 0, sent: 0, skipped: 0 };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  // Target: completed bookings where the job ended at least
  // organizations.internal_review_delay_minutes ago (default 120 min /
  // 2h per product decision), no review request sent yet, and the
  // client has an email. The MAX window cap (72h) is a safety: if the
  // cron was down for days, we don't suddenly blast a backlog of
  // week-old jobs with "how did we do?" emails that feel stale.
  //
  // The org-level delay is enforced in the per-booking branch below
  // (after we have the org's configured value) so we can honor each
  // org's setting in a single batched query.
  //
  // Earliest-cutoff bumped from 72h to 30d. The original 72h ceiling
  // permanently silenced any booking the cron missed during multi-day
  // downtime; the dedup column (review_request_sent_at) prevents
  // doubling-up, so a 30d window is safe and gives us a month of
  // catch-up if Vercel crons go dark. We DO want some ceiling so that
  // enabling the feature for the first time on an org with years of
  // history doesn't blast a year of "How did we do?" emails.
  const earliestCutoff = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const latestCutoff = new Date(
    Date.now() - 30 * 60 * 1000, // at LEAST 30 min must have elapsed
  ).toISOString();

  const { data: candidates } = (await db
    .from("bookings")
    .select(
      `
      id, organization_id, scheduled_at, service_type, duration_minutes, assigned_to,
      client:clients ( id, name, email ),
      assigned:memberships!bookings_assigned_to_fkey (
        display_name,
        profile:profiles ( full_name )
      )
    `,
    )
    .eq("status", "completed")
    .is("review_request_sent_at", null)
    .gte("scheduled_at", earliestCutoff)
    .lte("scheduled_at", latestCutoff)
    // Deterministic under backlog — oldest first so catch-up drains in order.
    .order("scheduled_at", { ascending: true })
    .limit(200)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      service_type: string;
      duration_minutes: number;
      assigned_to: string | null;
      client: {
        id: string;
        name: string | null;
        email: string | null;
      } | null;
      assigned: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let sent = 0;
  let skipped = 0;

  if (!candidates || candidates.length === 0) {
    return { considered, sent, skipped };
  }

  // PER-CLIENT CAP (audit G1). Dedup was per-BOOKING only, so a weekly client
  // with 4 completed jobs in the window got 4 "how did we do?" emails in one
  // run — and enabling the toggle on an org with recent history flooded every
  // recurring client at once. Two rules:
  //   1. At most ONE ask per client per run — their most recent qualifying job.
  //   2. Skip clients already asked in the last 30 days (any booking of theirs
  //      with a review_request_sent_at inside the window).
  const bestPerClient = new Map<string, (typeof candidates)[number]>();
  for (const b of candidates) {
    if (!b.client?.id) continue;
    const prev = bestPerClient.get(b.client.id);
    if (!prev || b.scheduled_at > prev.scheduled_at) {
      bestPerClient.set(b.client.id, b);
    }
  }
  // PER-ORG ASK CADENCE. The fixed 30-day gap meant a weekly client was
  // asked "how did we do?" every month, forever — and a client who had
  // just LEFT a review got asked again anyway. Each org now configures
  // the gap (Settings -> Automations, beside the toggle): after every
  // clean (legacy 30d), 4x, 2x, or once a year. Two skips per client,
  // both scoped to their org's gap:
  //   1. ASKED within the gap (any booking's review_request_sent_at)
  //   2. REVIEWED within the gap — a submitted review is the strongest
  //      possible "stop asking"; volunteering via the portal is separate
  //      and never throttled.
  const { reviewAskGapDays } = await import("@/lib/review-cadence");
  const clientOrg = new Map<string, string>();
  for (const b of bestPerClient.values()) {
    if (b.client?.id) clientOrg.set(b.client.id, b.organization_id);
  }
  const freqOrgIds = Array.from(new Set(clientOrg.values()));
  const gapByOrg = new Map<string, number>();
  if (freqOrgIds.length > 0) {
    const { data: orgRows } = (await db
      .from("organizations")
      .select("id, automation_settings")
      .in("id", freqOrgIds)) as unknown as {
      data: Array<{ id: string; automation_settings: unknown }> | null;
    };
    for (const o of orgRows ?? []) {
      gapByOrg.set(o.id, reviewAskGapDays(o.automation_settings));
    }
  }
  const gapMsFor = (clientId: string) =>
    (gapByOrg.get(clientOrg.get(clientId) ?? "") ?? 30) * 24 * 60 * 60 * 1000;
  const maxGapDays = Math.max(30, ...Array.from(gapByOrg.values()));
  const oldestThreshold = new Date(
    Date.now() - maxGapDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const recentlyAskedClients = new Set<string>();
  {
    const clientIds = Array.from(bestPerClient.keys());
    if (clientIds.length > 0) {
      const { data: asked } = (await db
        .from("bookings")
        .select("client_id, review_request_sent_at")
        .in("client_id", clientIds)
        .gte("review_request_sent_at", oldestThreshold)) as unknown as {
        data: Array<{
          client_id: string | null;
          review_request_sent_at: string | null;
        }> | null;
      };
      for (const r of asked ?? []) {
        if (!r.client_id || !r.review_request_sent_at) continue;
        if (
          Date.parse(r.review_request_sent_at) >=
          Date.now() - gapMsFor(r.client_id)
        ) {
          recentlyAskedClients.add(r.client_id);
        }
      }
      const { data: reviewed } = (await db
        .from("reviews")
        .select("client_id, submitted_at")
        .in("client_id", clientIds)
        .gte("submitted_at", oldestThreshold)) as unknown as {
        data: Array<{
          client_id: string | null;
          submitted_at: string | null;
        }> | null;
      };
      for (const r of reviewed ?? []) {
        if (!r.client_id || !r.submitted_at) continue;
        if (Date.parse(r.submitted_at) >= Date.now() - gapMsFor(r.client_id)) {
          recentlyAskedClients.add(r.client_id);
        }
      }
    }
  }
  const perClientCandidates = Array.from(bestPerClient.values()).filter(
    (b) => !recentlyAskedClients.has(b.client!.id),
  );
  skipped += candidates.length - perClientCandidates.length;

  // Cache org settings + branding across the batch.
  const orgCache = new Map<
    string,
    {
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      enabled: boolean;
      /** Org-configured delay (minutes) after job end before the
       *  internal review email is allowed to fire. We filter per-booking
       *  rather than globally because different orgs may set different
       *  values. */
      internal_review_delay_minutes: number;
    } | null
  >();

  const now = Date.now();

  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();

  for (const booking of perClientCandidates) {
    if (!booking.client?.email) {
      skipped += 1;
      continue;
    }

    // Client notification preference (growth category).
    const decision = await resolveClientNotify(db, {
      organizationId: booking.organization_id,
      clientId: booking.client.id,
      category: "growth",
      event: "review_request",
      orgDefaultCache,
    });
    if (!decision.email) {
      skipped += 1;
      continue;
    }

    let cached = orgCache.get(booking.organization_id);
    if (cached === undefined) {
      const enabled = await isAutomationEnabled(
        booking.organization_id,
        "review_request_after_completion",
      );
      const { data: orgData } = (await db
        .from("organizations")
        .select("name, brand_color, logo_url, internal_review_delay_minutes")
        .eq("id", booking.organization_id)
        .maybeSingle()) as unknown as {
        data: {
          name: string;
          brand_color: string | null;
          logo_url: string | null;
          internal_review_delay_minutes: number | null;
        } | null;
      };
      cached = orgData
        ? {
            name: orgData.name,
            brand_color: orgData.brand_color,
            logo_url: orgData.logo_url,
            enabled,
            internal_review_delay_minutes:
              orgData.internal_review_delay_minutes ?? 120,
          }
        : null;
      orgCache.set(booking.organization_id, cached);
    }

    if (!cached?.enabled) {
      skipped += 1;
      continue;
    }

    // Honor the org's configured delay. The DB query already excluded
    // jobs that ended < 30 min ago; this additional check makes sure
    // an org set to 6h doesn't get an email at the 2h-default mark.
    const jobEndedAt =
      new Date(booking.scheduled_at).getTime() +
      booking.duration_minutes * 60 * 1000;
    const delayMs = cached.internal_review_delay_minutes * 60 * 1000;
    if (now - jobEndedAt < delayMs) {
      skipped += 1;
      continue;
    }

    try {
      // Mint the review token and stamp sent timestamp atomically.
      const reviewToken = await generateClaimToken();
      // Atomic claim: WHERE review_request_sent_at IS NULL + .select()
      // back so we can tell whether we actually won. If a parallel
      // cron beat us to it (Vercel deduplicates same-cron invocations
      // but defense is cheap), the UPDATE matches zero rows and we
      // skip without re-sending. The race window without this check
      // is small but non-zero.
      const { data: stamped, error: updateErr } = (await db
        .from("bookings")
        .update({
          review_token: reviewToken,
          review_request_sent_at: new Date().toISOString(),
        })
        .eq("id", booking.id)
        .is("review_request_sent_at", null)
        .select("id")) as unknown as {
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      };

      if (updateErr) {
        console.error(
          "[auto] review token stamp failed:",
          booking.id,
          updateErr.message,
        );
        skipped += 1;
        continue;
      }
      if (!stamped || stamped.length === 0) {
        // Lost the race — another cron just stamped this booking.
        // Drop the silently-minted reviewToken; the winner already
        // wrote its own. No retry needed.
        skipped += 1;
        continue;
      }

      const reviewUrl = `${siteUrl}/review/${reviewToken}`;
      // Personalize with the cleaner's first name if we have one —
      // "How was Sarah?" reliably beats "How did we do?" on engagement.
      const employeeName = (() => {
        const full =
          booking.assigned?.profile?.full_name ??
          booking.assigned?.display_name ??
          null;
        // Empty AND whitespace-only both rejected so we never email
        // "How was   ?". The ?.trim() prevents a "   " value (which
        // is truthy) from sneaking past the falsy check.
        const trimmed = full?.trim();
        if (!trimmed) return undefined;
        return trimmed.split(/\s+/)[0]; // first name only
      })();
      const template = reviewRequestEmail({
        clientName: booking.client.name ?? "there",
        orgName: cached.name,
        employeeName,
        reviewUrl,
        brandColor: cached.brand_color ?? undefined,
        logoUrl: cached.logo_url ?? undefined,
      });

      const ok = await sendOrgEmail(booking.organization_id, {
        to: booking.client.email,
        toName: booking.client.name ?? undefined,
        ...template,
      });

      if (ok) {
        sent += 1;
        console.log(
          `[auto] Review request sent for booking ${booking.id} to ${booking.client.email}`,
        );
      } else {
        // Email failed — un-stamp so the next cron run retries.
        await db
          .from("bookings")
          .update({
            review_request_sent_at: null,
            review_token: null,
          })
          .eq("id", booking.id);
        skipped += 1;
      }
    } catch (err) {
      console.error(
        "[auto] sendBookingReviewRequests booking error:",
        booking.id,
        err,
      );
      skipped += 1;
    }
  }

  return { considered, sent, skipped };
}

// ─────────────────────────────────────────────────────────────────
// 7c-3. Google review request (DAILY cron)
//
// Two phases handled in one pass:
//
//   PHASE A — Initial ask
//     Trigger: 48h after the client's FIRST completed booking
//     Per-client (not per-booking). State moves never_asked → pending.
//
//   PHASE B — Escalating reminders
//     First reminder 7 days after the initial ask, then every
//     `gbp_review_reminder_days` (default 30) while state = pending,
//     capped at `gbp_review_max_reminders` total (default 5).
//     Reminder counter increments each time. When the cap is hit,
//     state flips to lapsed and the client never receives another
//     reminder unless the owner manually re-enables.
//     Default cadence: ask at 48h → +1wk → then monthly ×4 → lapsed.
//
// Stop signals (any of these means we never email again):
//   - Customer clicked the /r/g/<token> link → state = clicked
//   - Customer clicked /u/g/<token> unsubscribe → state = opted_out
//   - Owner manually marked reviewed → state = reviewed
//   - Reminder cap hit → state = lapsed
//
// Gated:
//   1. Platform kill switch (CLIENT_EMAILS_PAUSED)
//   2. Per-org toggle `gbp_review_request`
//   3. Org must have google_review_url configured
//   4. Client must have an email
//   5. State machine (never_asked or pending only)
// ─────────────────────────────────────────────────────────────────

// Gap between the initial ask and the first reminder. Reminders after
// the first use the org-tunable gbp_review_reminder_days (default 30).
const GBP_FIRST_REMINDER_DAYS = 7;

export async function sendGbpReviewRequests(): Promise<{
  considered: number;
  initialSent: number;
  remindersSent: number;
  lapsed: number;
  skipped: number;
}> {
  const db = admin();
  const { sendOrgEmail, isClientEmailPaused } = await import("@/lib/email");
  const { gbpReviewRequestEmail, gbpReviewReminderEmail } =
    await import("@/lib/email-templates");
  const { generateClaimToken } = await import("@/lib/claim-token");

  if (isClientEmailPaused()) {
    console.log(
      "[auto] sendGbpReviewRequests: CLIENT_EMAILS_PAUSED — skipping",
    );
    return {
      considered: 0,
      initialSent: 0,
      remindersSent: 0,
      lapsed: 0,
      skipped: 0,
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const nowIso = new Date().toISOString();
  const now = Date.now();

  let initialSent = 0;
  let remindersSent = 0;
  let lapsed = 0;
  let skipped = 0;

  // -----------------------------------------------------------------
  // PHASE A: Initial asks
  // -----------------------------------------------------------------
  // A client qualifies for the initial ask when:
  //   - gbp_review_state = 'never_asked'
  //   - has email
  //   - has a completed booking that ended >= 48h ago and <= 14d ago
  //     (48h gives the experience time to settle so the ask doesn't
  //     read as a same-day auto-blast; 14d ceiling avoids dredging up
  //     ancient first-jobs after the feature is enabled for the first
  //     time — we don't want to spam existing customers from 6 months
  //     ago)
  //   - org has gbp_review_request automation enabled
  //   - org has google_review_url set
  const earliestFirstJob = new Date(
    now - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const latestFirstJob = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  // Pull qualifying candidate (client, oldest-completed-booking) pairs.
  // We use a bookings query because we need the triggering booking id.
  const { data: initialCandidates } = (await db
    .from("bookings")
    .select(
      `
      id, organization_id, scheduled_at, duration_minutes,
      client:clients!inner ( id, name, email, gbp_review_state, gbp_redirect_token, gbp_unsubscribe_token )
    `,
    )
    .eq("status", "completed")
    .gte("scheduled_at", earliestFirstJob)
    .lte("scheduled_at", latestFirstJob)
    .eq("client.gbp_review_state", "never_asked")
    .not("client.email", "is", null)
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      duration_minutes: number;
      client: {
        id: string;
        name: string | null;
        email: string | null;
        gbp_review_state: string;
        gbp_redirect_token: string | null;
        gbp_unsubscribe_token: string | null;
      } | null;
    }> | null;
  };

  // Dedup to one booking per client — earliest scheduled_at wins,
  // matching "their FIRST completed job" intent. PostgREST gave us
  // rows ordered arbitrarily; sort here.
  const byClient = new Map<
    string,
    NonNullable<typeof initialCandidates>[number]
  >();
  for (const row of initialCandidates ?? []) {
    if (!row.client) continue;
    const existing = byClient.get(row.client.id);
    if (
      !existing ||
      new Date(row.scheduled_at).getTime() <
        new Date(existing.scheduled_at).getTime()
    ) {
      byClient.set(row.client.id, row);
    }
  }

  const considered = byClient.size;
  const orgCache = await buildOrgGbpCache(
    db,
    Array.from(
      new Set(Array.from(byClient.values()).map((r) => r.organization_id)),
    ),
  );

  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();

  for (const row of byClient.values()) {
    const client = row.client!;
    const org = orgCache.get(row.organization_id);
    if (!org || !org.enabled || !org.google_review_url) {
      skipped += 1;
      continue;
    }

    // Client notification preference (growth category).
    const askDecision = await resolveClientNotify(db, {
      organizationId: row.organization_id,
      clientId: client.id,
      category: "growth",
      event: "gbp_review_request",
      orgDefaultCache,
    });
    if (!askDecision.email) {
      skipped += 1;
      continue;
    }

    try {
      // Mint tokens lazily — most clients will never reach this point,
      // so we don't pre-allocate for everyone.
      const redirectToken =
        client.gbp_redirect_token ?? (await generateClaimToken(24));
      const unsubToken =
        client.gbp_unsubscribe_token ?? (await generateClaimToken(24));

      // Escalating cadence: the FIRST reminder lands one week after the
      // initial ask (strike while the clean is fresh); reminders after
      // that fall back to the org's monthly interval — see Phase B.
      const nextReminderAt = new Date(
        now + GBP_FIRST_REMINDER_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      // Atomic claim with rowcount check. WHERE state = 'never_asked'
      // is the race guard; .select() back tells us whether THIS UPDATE
      // actually flipped a row. Both error path AND zero-rowcount path
      // skip the send — without the rowcount check, a parallel cron
      // that beat us to it would still proceed to mail.
      const { data: claimed, error: stampErr } = (await db
        .from("clients")
        .update({
          gbp_review_state: "pending",
          gbp_first_asked_at: nowIso,
          gbp_last_asked_at: nowIso,
          gbp_next_reminder_at: nextReminderAt,
          gbp_redirect_token: redirectToken,
          gbp_unsubscribe_token: unsubToken,
        })
        .eq("id", client.id)
        .eq("gbp_review_state", "never_asked")
        .select("id")) as unknown as {
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      };
      if (stampErr) {
        skipped += 1;
        continue;
      }
      if (!claimed || claimed.length === 0) {
        // Lost the race — someone else just transitioned this client
        // out of never_asked. No retry, no email.
        skipped += 1;
        continue;
      }

      const template = gbpReviewRequestEmail({
        clientName: client.name ?? "there",
        orgName: org.name,
        redirectUrl: `${siteUrl}/r/g/${redirectToken}`,
        unsubscribeUrl: `${siteUrl}/u/g/${unsubToken}`,
        brandColor: org.brand_color ?? undefined,
        logoUrl: org.logo_url ?? undefined,
      });

      const ok = await sendOrgEmail(row.organization_id, {
        to: client.email!,
        toName: client.name ?? undefined,
        ...template,
        unsubscribeUrl: `${siteUrl}/api/u/g/${unsubToken}`,
      });

      if (ok) {
        initialSent += 1;
      } else {
        // Roll back state so the next cron run retries.
        await db
          .from("clients")
          .update({
            gbp_review_state: "never_asked",
            gbp_first_asked_at: null,
            gbp_last_asked_at: null,
            gbp_next_reminder_at: null,
          })
          .eq("id", client.id);
        skipped += 1;
      }
    } catch (err) {
      console.error(
        "[auto] sendGbpReviewRequests initial error:",
        client.id,
        err,
      );
      skipped += 1;
    }
  }

  // -----------------------------------------------------------------
  // PHASE B: Reminders
  // -----------------------------------------------------------------
  // Pending clients whose next_reminder_at is <= now.
  const { data: reminderCandidates } = (await db
    .from("clients")
    .select(
      "id, organization_id, name, email, gbp_reminders_sent, gbp_last_asked_at, gbp_next_reminder_at, gbp_redirect_token, gbp_unsubscribe_token",
    )
    .eq("gbp_review_state", "pending")
    .lte("gbp_next_reminder_at", nowIso)
    .not("email", "is", null)
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      name: string | null;
      email: string | null;
      gbp_reminders_sent: number;
      gbp_last_asked_at: string | null;
      gbp_next_reminder_at: string | null;
      gbp_redirect_token: string | null;
      gbp_unsubscribe_token: string | null;
    }> | null;
  };

  // Expand the org cache for any orgs we haven't loaded yet (reminder
  // batch may include orgs that had no initial-ask candidates today).
  await expandOrgGbpCache(
    db,
    orgCache,
    (reminderCandidates ?? []).map((c) => c.organization_id),
  );

  for (const c of reminderCandidates ?? []) {
    const org = orgCache.get(c.organization_id);
    if (!org || !org.enabled || !org.google_review_url) {
      skipped += 1;
      continue;
    }
    if (!c.email || !c.gbp_redirect_token || !c.gbp_unsubscribe_token) {
      // Should not happen for state=pending — tokens are minted at
      // initial-ask time — but be defensive against partial rows.
      skipped += 1;
      continue;
    }

    // Client notification preference (growth category) — honour a client who
    // was switched to do-not-contact after the initial ask.
    const remDecision = await resolveClientNotify(db, {
      organizationId: c.organization_id,
      clientId: c.id,
      category: "growth",
      event: "gbp_review_request",
      orgDefaultCache,
    });
    if (!remDecision.email) {
      skipped += 1;
      continue;
    }

    // Check the cap. Reminders already sent + this one > max means lapse.
    // Lapse via a CAS UPDATE so a parallel cron can't accidentally
    // lapse-then-restore-then-lapse a client whose state was just
    // changed by a click or opt-out.
    const nextCount = c.gbp_reminders_sent + 1;
    if (nextCount > org.max_reminders) {
      await db
        .from("clients")
        .update({
          gbp_review_state: "lapsed",
          gbp_next_reminder_at: null,
        })
        .eq("id", c.id)
        .eq("gbp_review_state", "pending");
      lapsed += 1;
      continue;
    }

    // CAS-claim the reminder slot BEFORE sending. WHERE guards on
    // both state ("pending") AND counter (must match what we read)
    // make this atomic: if a parallel cron already incremented the
    // counter, or a click / opt-out / mark-reviewed transitioned the
    // state, our UPDATE matches zero rows and we skip without
    // sending. Without this, two crons reading counter=4 could both
    // proceed to send (double email, double Resend quota burn) before
    // either wrote 5. Send-first-update-second was the original
    // shape; claim-first is the safer one.
    const nextReminderAt = new Date(
      now + org.reminder_days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: claimed } = (await db
      .from("clients")
      .update({
        gbp_reminders_sent: nextCount,
        gbp_last_asked_at: nowIso,
        gbp_next_reminder_at: nextReminderAt,
      })
      .eq("id", c.id)
      .eq("gbp_review_state", "pending")
      .eq("gbp_reminders_sent", c.gbp_reminders_sent)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
    };
    if (!claimed || claimed.length === 0) {
      // Lost the race or state changed mid-batch (clicked, opted_out,
      // reviewed, lapsed). Skip without sending.
      skipped += 1;
      continue;
    }

    try {
      const template = gbpReviewReminderEmail({
        clientName: c.name ?? "there",
        orgName: org.name,
        redirectUrl: `${siteUrl}/r/g/${c.gbp_redirect_token}`,
        unsubscribeUrl: `${siteUrl}/u/g/${c.gbp_unsubscribe_token}`,
        reminderNumber: nextCount,
        brandColor: org.brand_color ?? undefined,
        logoUrl: org.logo_url ?? undefined,
      });

      const ok = await sendOrgEmail(c.organization_id, {
        to: c.email,
        toName: c.name ?? undefined,
        ...template,
        unsubscribeUrl: `${siteUrl}/api/u/g/${c.gbp_unsubscribe_token}`,
      });

      if (ok) {
        remindersSent += 1;
      } else {
        // Send failed AFTER we claimed the slot — roll back so the
        // next cron run can retry. We restore the counter and
        // schedule an immediate retry; gbp_last_asked_at may show
        // the failed attempt's timestamp instead of the prior value
        // (we only SELECTed enough to roll back the cron-relevant
        // fields), which is acceptable cosmetic drift.
        await db
          .from("clients")
          .update({
            gbp_reminders_sent: c.gbp_reminders_sent,
            gbp_next_reminder_at: c.gbp_next_reminder_at ?? nowIso,
            gbp_last_asked_at: c.gbp_last_asked_at,
          })
          .eq("id", c.id);
        skipped += 1;
      }
    } catch (err) {
      console.error("[auto] sendGbpReviewRequests reminder error:", c.id, err);
      skipped += 1;
    }
  }

  return { considered, initialSent, remindersSent, lapsed, skipped };
}

type OrgGbpCacheEntry = {
  name: string;
  brand_color: string | null;
  logo_url: string | null;
  google_review_url: string | null;
  enabled: boolean;
  reminder_days: number;
  max_reminders: number;
};

async function buildOrgGbpCache(
  db: ReturnType<typeof admin>,
  orgIds: string[],
): Promise<Map<string, OrgGbpCacheEntry>> {
  const cache = new Map<string, OrgGbpCacheEntry>();
  await expandOrgGbpCache(db, cache, orgIds);
  return cache;
}

async function expandOrgGbpCache(
  db: ReturnType<typeof admin>,
  cache: Map<string, OrgGbpCacheEntry>,
  orgIds: string[],
): Promise<void> {
  const missing = Array.from(new Set(orgIds)).filter((id) => !cache.has(id));
  if (missing.length === 0) return;

  const { data } = (await db
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, google_review_url, gbp_review_reminder_days, gbp_review_max_reminders",
    )
    .in("id", missing)) as unknown as {
    data: Array<{
      id: string;
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      google_review_url: string | null;
      gbp_review_reminder_days: number | null;
      gbp_review_max_reminders: number | null;
    }> | null;
  };

  for (const o of data ?? []) {
    const enabled = await isAutomationEnabled(o.id, "gbp_review_request");
    cache.set(o.id, {
      name: o.name,
      brand_color: o.brand_color,
      logo_url: o.logo_url,
      google_review_url: o.google_review_url,
      enabled,
      reminder_days: o.gbp_review_reminder_days ?? 30,
      max_reminders: o.gbp_review_max_reminders ?? 5,
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// 7d. Client-facing 24-hour booking reminder (daily cron)
//
// Runs daily. Finds bookings scheduled between ~18h and ~30h from now
// that haven't been client-reminded yet, and emails the client. The
// window straddles 24h so clients get a consistent "day before" cadence
// regardless of the exact time-of-day the job is booked for.
//
// Gated three ways:
//   1. Platform kill switch via sendOrgEmail (CLIENT_EMAILS_PAUSED)
//   2. Per-org automation toggle `booking_reminder_client_email`
//   3. Dedup by bookings.client_reminder_sent_at — each booking is
//      reminded at most once, ever.
// ─────────────────────────────────────────────────────────────────

export async function sendUpcomingBookingReminders(): Promise<{
  considered: number;
  sent: number;
  skipped: number;
}> {
  const db = admin();
  const { sendOrgEmail } = await import("@/lib/email");
  const { bookingReminderEmail } = await import("@/lib/email-templates");

  const now = Date.now();
  // The reminder cron runs once daily. With the old 18–30h window (only 12h
  // wide) any booking scheduled for the evening fell into the gap between two
  // consecutive daily runs and got NO reminder at all. To tile without gaps at
  // a daily cadence the window must be ≥24h wide; 6–32h (26h) reminds every
  // booking exactly once — the dedup on client_reminder_sent_at absorbs the
  // small overlap between runs.
  const windowStart = new Date(now + 6 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 32 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = (await db
    .from("bookings")
    .select(
      `
      id, organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_label, address,
      client:clients ( name, email, phone )
    `,
    )
    .is("client_reminder_sent_at", null)
    // Confirmed only. Pending used to be safe here because both of its
    // producers pre-stamp client_reminder_sent_at, but that is not a durable
    // guard: a manager picking Pending in the form gets no stamp, and
    // updateBookingAction clears the stamp on every reschedule. A pending
    // booking that gets its real date set would be re-armed, and the client
    // would be told "your job is tomorrow" for a job nobody confirmed.
    .eq("status", "confirmed")
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      client_id: string | null;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      service_type_label: string | null;
      address: string | null;
      client: {
        name: string | null;
        email: string | null;
        phone: string | null;
      } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let sent = 0;
  let skipped = 0;

  if (!candidates || candidates.length === 0) {
    return { considered, sent, skipped };
  }

  // Cache org lookups (toggle + branding) across the batch.
  const orgCache = new Map<
    string,
    {
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      timezone: string | null;
      contact_phone: string | null;
      enabled: boolean;
    } | null
  >();
  // Cache the org default across the batch so we fetch it once per org.
  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();

  for (const booking of candidates) {
    // Isolate each booking — one thrown error must not abort the rest of
    // the batch (a lost tail can age out of the reminder window by the
    // next run and never be reminded).
    try {
      const hasEmail = Boolean(booking.client?.email);
      const hasPhone = Boolean(booking.client?.phone);
      // Need at least one reachable channel. (Previously required an email, which
      // silently dropped SMS-only clients — and their reminder text with it.)
      if (!hasEmail && !hasPhone) {
        skipped += 1;
        continue;
      }
      // Narrow client to non-null for the rest of the loop (hasEmail/hasPhone
      // already imply it's set, but TS can't infer that from the booleans).
      if (!booking.client) {
        skipped += 1;
        continue;
      }

      let cached = orgCache.get(booking.organization_id);
      if (cached === undefined) {
        const enabled = await isAutomationEnabled(
          booking.organization_id,
          "booking_reminder_client_email",
        );
        const { data: orgData } = (await db
          .from("organizations")
          .select("name, brand_color, logo_url, timezone, contact_phone")
          .eq("id", booking.organization_id)
          .maybeSingle()) as unknown as {
          data: {
            name: string;
            brand_color: string | null;
            logo_url: string | null;
            timezone: string | null;
            contact_phone: string | null;
          } | null;
        };
        cached = orgData ? { ...orgData, enabled } : null;
        orgCache.set(booking.organization_id, cached);
      }

      if (!cached) {
        skipped += 1;
        continue;
      }
      // NOTE: cached.enabled is the EMAIL toggle (booking_reminder_client_email).
      // It now gates ONLY the email channel below — not the whole booking — so an
      // org that wants SMS-only reminders still gets them.

      // Per-client channel preference (booking category). Layered under the toggle.
      const decision = await resolveClientNotify(db, {
        organizationId: booking.organization_id,
        clientId: booking.client_id,
        category: "booking",
        event: "reminder",
        orgDefaultCache,
      });

      const dateTime = new Date(booking.scheduled_at).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: cached.timezone ?? "America/Edmonton",
      });

      const { resolveTeamDivision, crewFinishNote } =
        await import("@/lib/crew-hours");
      const division = await resolveTeamDivision(
        booking.id,
        booking.duration_minutes,
      );
      const crewNote = crewFinishNote(
        division,
        booking.scheduled_at,
        cached.timezone ?? "America/Edmonton",
      );

      const template = bookingReminderEmail({
        clientName: booking.client.name ?? "there",
        orgName: cached.name,
        serviceName:
          booking.service_type_label ?? humanize(booking.service_type),
        dateTime,
        crewNote,
        address: booking.address ?? "(address on file)",
        brandColor: cached.brand_color ?? undefined,
        logoUrl: cached.logo_url ?? undefined,
      });

      // Two INDEPENDENT channels. Previously the SMS was nested inside the
      // email-success branch, so a paused/failed/absent email silently killed
      // the reminder text even when SMS + opt-in were ready. Now each channel
      // stands on its own gates and we stamp if EITHER one delivers.
      let anySent = false;

      // ── Email channel — gated by the email toggle AND the client preference. ──
      if (hasEmail && cached.enabled && decision.email) {
        const emailOk = await sendOrgEmail(booking.organization_id, {
          to: booking.client.email!,
          toName: booking.client.name ?? undefined,
          ...template,
        });
        if (emailOk) {
          anySent = true;
        } else {
          console.log(
            `[auto] Booking reminder email not sent for ${booking.id} (paused/unconfigured/rejected)`,
          );
        }
      }

      // ── SMS channel — INDEPENDENT of email. sendOrgSms applies its own gates
      //    (booking_reminder_client_sms toggle, client opt-in, cap,
      //    CLIENT_SMS_PAUSED, TWILIO_ENABLED). Plus the client preference. ──
      if (hasPhone && decision.sms) {
        try {
          const { sendOrgSms } = await import("@/lib/sms");
          const { composeBookingReminderSms } = await import("@/lib/twilio");
          const { getOrgTimezone } = await import("@/lib/org-timezone");
          const orgTz = await getOrgTimezone(booking.organization_id);
          const smsBody = composeBookingReminderSms({
            orgName: cached.name,
            serviceType: booking.service_type,
            scheduledAt: booking.scheduled_at,
            // From the org cache — this used to be a fresh query per booking.
            contactPhone: cached.contact_phone ?? null,
            tz: orgTz,
          });
          const smsRes = await sendOrgSms(booking.organization_id, {
            to: booking.client.phone!,
            body: smsBody,
            automationKey: "booking_reminder_client_sms",
          });
          if (smsRes.ok && smsRes.status === "sent") anySent = true;
        } catch (smsErr) {
          console.error(
            "[auto] sendUpcomingBookingReminders SMS path errored:",
            smsErr,
          );
        }
      }

      // Stamp only if at least one channel actually delivered — so a fully-gated
      // booking retries next tick instead of being marked reminded, and a booking
      // isn't reminded twice once one channel lands.
      if (anySent) {
        await db
          .from("bookings")
          .update({ client_reminder_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
        sent += 1;
        console.log(
          `[auto] Booking reminder delivered for booking ${booking.id}`,
        );
      } else {
        skipped += 1;
      }
    } catch (bookingErr) {
      skipped += 1;
      console.error(
        `[auto] reminder failed for booking ${booking.id} — continuing batch:`,
        bookingErr,
      );
    }
  }

  return { considered, sent, skipped };
}

// ─────────────────────────────────────────────────────────────────
// 7e. Send an estimate to the client (user-initiated from the admin UI)
//
// Generates a public_token + expires_at on first send if not already
// present, then emails the client with a link to /e/<token>. Idempotent:
// re-sending bumps client_email_sent_at but keeps the existing token.
//
// Gated ONLY by the platform kill switch (via sendOrgEmail). Deliberately NOT
// behind an automation toggle: this is the owner clicking "Send to client" —
// a manual act, not an automation. It used to be gated by an
// `estimate_sent_email` toggle, which under the opt-in-everything policy meant
// a fresh org couldn't send estimates at all until they found and enabled a
// toggle for a button they'd already clicked. Removed.
// ─────────────────────────────────────────────────────────────────

export async function sendEstimateToClient(
  estimateId: string,
  opts: {
    manualSend?: boolean;
    /**
     * Caller's org id. REQUIRED for user-initiated sends: this function uses
     * the service-role client, so without this scope any authenticated member
     * of any org could force-send another org's estimate by UUID (audit G2).
     */
    organizationId?: string;
  } = {},
): Promise<{
  ok: boolean;
  publicToken: string | null;
  error?: string;
}> {
  try {
    const db = admin();
    const { sendOrgEmailDetailed } = await import("@/lib/email");
    const { estimateSentEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");
    const { getOrgCurrency } = await import("@/lib/org-currency");
    const { generateClaimToken } = await import("@/lib/claim-token");

    let estimateQuery = db
      .from("estimates")
      .select(
        `
        id, organization_id, client_id, service_description, total_cents,
        status, public_token, expires_at,
        client:clients ( name, email )
      `,
      )
      .eq("id", estimateId);
    if (opts.organizationId) {
      estimateQuery = estimateQuery.eq("organization_id", opts.organizationId);
    }
    const { data: estimate } =
      (await estimateQuery.maybeSingle()) as unknown as {
        data: {
          id: string;
          organization_id: string;
          client_id: string;
          service_description: string | null;
          total_cents: number;
          status: string;
          public_token: string | null;
          expires_at: string | null;
          client: { name: string | null; email: string | null } | null;
        } | null;
      };

    if (!estimate)
      return { ok: false, publicToken: null, error: "Estimate not found" };
    if (!estimate.client?.email) {
      return {
        ok: false,
        publicToken: null,
        error: "Client has no email on file",
      };
    }

    // Lazily mint a public token + 30-day expiry on first send. Conditional
    // on still-null so two admins clicking Send simultaneously can't each mint
    // a token with last-write-wins — the loser's email would carry a dead /e/
    // link. Zero rows back = someone else won; re-read and use theirs.
    let publicToken = estimate.public_token;
    let expiresAt = estimate.expires_at;
    if (!publicToken) {
      publicToken = generateClaimToken();
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: minted } = (await db
        .from("estimates")
        .update({
          public_token: publicToken,
          expires_at: expiresAt,
        })
        .eq("id", estimateId)
        .is("public_token", null)
        .select("id")) as unknown as { data: Array<{ id: string }> | null };
      if (!minted || minted.length === 0) {
        const { data: winner } = (await db
          .from("estimates")
          .select("public_token, expires_at")
          .eq("id", estimateId)
          .maybeSingle()) as unknown as {
          data: {
            public_token: string | null;
            expires_at: string | null;
          } | null;
        };
        publicToken = winner?.public_token ?? publicToken;
        expiresAt = winner?.expires_at ?? expiresAt;
      }
    }

    const { data: orgData } = (await db
      .from("organizations")
      .select("name, brand_color, logo_url")
      .eq("id", estimate.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        name: string;
        brand_color: string | null;
        logo_url: string | null;
      } | null;
    };

    const orgName = orgData?.name ?? "Your service provider";
    const currency = await getOrgCurrency(estimate.organization_id);
    const { getOrgTimezone: getEstimateTz } =
      await import("@/lib/org-timezone");
    const estimateTz = await getEstimateTz(estimate.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    // expires_at is a timestamptz (now() + 30 days), so the time of day is
    // real. Formatted in UTC on Vercel, an estimate sent after 6 PM Edmonton
    // promised "Expires Sep 4" for a link that dies the evening of Sep 3.
    const expiresOn = expiresAt
      ? new Date(expiresAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: estimateTz,
        })
      : null;

    const template = estimateSentEmail({
      clientName: estimate.client.name ?? "there",
      orgName,
      amountFormatted: formatCurrencyCents(estimate.total_cents, currency),
      serviceDescription: estimate.service_description ?? "",
      publicUrl: `${siteUrl}/e/${publicToken}`,
      expiresOn,
      brandColor: orgData?.brand_color ?? undefined,
      logoUrl: orgData?.logo_url ?? undefined,
    });

    // Attach a PDF snapshot of the estimate so the customer has a
    // permanent copy that survives the 30-day token expiry, and can
    // forward it to their accountant / file it for records without
    // depending on our hosted page staying up. Best-effort: if PDF
    // rendering fails (Chromium hiccup, cold-start timeout), we still
    // send the email — the link in the body works as the fallback.
    let pdfAttachment: {
      filename: string;
      content: Buffer;
      contentType: string;
    } | null = null;
    try {
      const { renderEstimatePdf } = await import("@/lib/estimate-pdf");
      const pdfBuffer = await renderEstimatePdf({ publicToken });
      const slug = (estimate.client.name ?? estimateId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      pdfAttachment = {
        filename: `estimate-${slug || estimateId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      };
    } catch (pdfErr) {
      // Don't fail the whole send if the PDF render hiccups. The
      // customer still gets the email with the link; we just lose
      // the attachment. Sentry picks this up in production.
      console.error(
        "[auto] estimate PDF attach failed (continuing without):",
        pdfErr,
      );
    }

    // Owner clicking "Send" should always go through, even when the
    // automated-client-email kill switch is on. The cron-driven follow-up
    // path (sendStaleEstimateFollowups) leaves manualSend false so it
    // still respects the kill switch.
    const sendResult = await sendOrgEmailDetailed(estimate.organization_id, {
      to: estimate.client.email,
      toName: estimate.client.name ?? undefined,
      pauseExempt: !!opts.manualSend,
      ...template,
      ...(pdfAttachment ? { attachments: [pdfAttachment] } : {}),
    });
    const sendOk = sendResult.ok;

    if (sendOk) {
      await db
        .from("estimates")
        .update({
          client_email_sent_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          // Resending restarts the clock, so the public link must live at
          // least as long as the follow-up track that references it —
          // previously sent_at was bumped but expires_at wasn't, so the
          // "view before it expires" email could link to a page already
          // showing "expired" (audit G5).
          expires_at: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          // Bump to "sent" for draft estimates. Don't downgrade
          // approved/declined if the admin re-sends.
          ...(estimate.status === "draft" ? { status: "sent" } : {}),
        })
        .eq("id", estimateId);

      // A quoted lead moves to "Quoted". The pipeline column existed and
      // was documented ("price is with them, waiting") but NOTHING ever
      // wrote it — every quoted lead sat in whatever stage it was dragged
      // to by hand. Leads only; a real client's lifecycle is untouched.
      await db
        .from("clients")
        .update({ lead_stage: "quoted" } as never)
        .eq("id", estimate.client_id)
        .eq("lifecycle" as never, "lead" as never)
        .in("lead_stage" as never, ["new", "contacted"] as never);
    }

    return { ok: sendOk, publicToken };
  } catch (err) {
    console.error("[auto] sendEstimateToClient failed:", err);
    return {
      ok: false,
      publicToken: null,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// 7. Notify employee when they're assigned to a booking
// ─────────────────────────────────────────────────────────────────

export async function notifyBookingAssignment(
  organizationId: string,
  bookingId: string,
  assignedTo: string,
  meta: {
    clientName: string;
    scheduledAt: string;
    serviceType: string;
    address: string | null;
  },
) {
  try {
    if (
      !(await isAutomationEnabled(organizationId, "booking_assignment_notify"))
    ) {
      console.log(
        `[auto] Booking assignment notify paused for org ${organizationId}`,
      );
      return;
    }

    const db = admin();

    // Fetch org name + timezone in one query (name used for SMS body, timezone
    // for local-time formatting in the notification body).
    const { data: orgData } = (await db
      .from("organizations")
      .select("name, timezone")
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: { name: string | null; timezone: string | null } | null;
    };
    const orgTz = orgData?.timezone ?? "America/Edmonton";

    const when = new Date(meta.scheduledAt).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: orgTz,
    });
    const title = "New shift assigned — tap to confirm";
    const body = `${humanize(meta.serviceType)} for ${meta.clientName} on ${when}${meta.address ? ` — ${meta.address}` : ""}. Open the job to accept or decline.`;

    await notify({
      audience: "membership",
      membershipId: assignedTo,
      organizationId,
      title,
      body,
      href: `/field/jobs/${bookingId}`,
    });

    // SMS to the employee's phone (when Twilio is on, they have a phone,
    // and the org has enabled booking_assignment_sms). Field crews check
    // SMS more reliably than push/in-app — a job they don't show up to
    // is worse than a spammy text.
    try {
      const { composeBookingAssignmentSms } = await import("@/lib/twilio");
      const { sendOrgSms } = await import("@/lib/sms");
      const { getOrgTimezone } = await import("@/lib/org-timezone");

      const { data: member } = (await db
        .from("memberships")
        .select("id, display_name, profile:profiles ( full_name, phone )")
        .eq("id", assignedTo)
        .maybeSingle()) as unknown as {
        data: {
          id: string;
          display_name: string | null;
          profile: { full_name: string | null; phone: string | null } | null;
        } | null;
      };

      const phone = member?.profile?.phone;
      if (phone) {
        // Reuse orgData already fetched above — no second round-trip needed.
        const orgTz = await getOrgTimezone(organizationId);
        const smsBody = composeBookingAssignmentSms({
          orgName: orgData?.name ?? "Sollos",
          serviceType: meta.serviceType,
          clientName: meta.clientName,
          scheduledAt: meta.scheduledAt,
          address: meta.address,
          tz: orgTz,
        });
        // Fire-and-forget — never block push dispatch. sendOrgSms
        // checks the platform kill switch + booking_assignment_sms
        // toggle + TWILIO_ENABLED (logs if disabled).
        sendOrgSms(organizationId, {
          to: phone,
          body: smsBody,
          automationKey: "booking_assignment_sms",
        }).catch((err) =>
          console.error("[auto] notifyBookingAssignment SMS failed:", err),
        );
      }
    } catch (smsErr) {
      console.error("[auto] notifyBookingAssignment SMS path errored:", smsErr);
    }

    console.log(
      `[auto] Notified ${assignedTo} about booking assignment ${bookingId}`,
    );
  } catch (err) {
    console.error("[auto] notifyBookingAssignment failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 8. Auto-send review request + receipt when invoice is fully paid
// ─────────────────────────────────────────────────────────────────

export async function autoOnInvoicePaid(invoiceId: string) {
  try {
    const db = admin();
    const { sendOrgEmail, isInvoiceEmailUnpaused } =
      await import("@/lib/email");
    const { reviewRequestEmail, paymentReceiptEmail } =
      await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");
    const { getOrgCurrency } = await import("@/lib/org-currency");
    const { generateClaimToken } = await import("@/lib/claim-token");

    const { data: invoice } = await db
      .from("invoices")
      .select(
        `
        id, number, organization_id, amount_cents, public_token, paid_at, booking_id,
        client:clients ( id, name, email )
      `,
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice || !invoice.client) return;

    if (
      !(await isAutomationEnabled(
        invoice.organization_id,
        "invoice_paid_receipt",
      ))
    ) {
      console.log(
        `[auto] Receipt + review request paused for org ${invoice.organization_id}`,
      );
      return;
    }

    // This function sends TWO different things, so each is gated on its own
    // category: the receipt is billing (email and/or text), the review
    // request is growth (email-only). A client can want invoices but no
    // review asks (or vice versa).
    const billingDecision = await resolveClientNotify(db, {
      organizationId: invoice.organization_id,
      clientId: invoice.client.id,
      category: "billing",
      event: "payment_receipt",
    });
    const growthDecision = await resolveClientNotify(db, {
      organizationId: invoice.organization_id,
      clientId: invoice.client.id,
      category: "growth",
      event: "review_request",
    });
    const receiptEmail = billingDecision.email && Boolean(invoice.client.email);
    const receiptSms =
      billingDecision.sms && Boolean(billingDecision.clientPhone);
    const reviewEmail = growthDecision.email && Boolean(invoice.client.email);
    if (!receiptEmail && !receiptSms && !reviewEmail) return;

    // CAS-claim the send. This now fires from payment webhooks as well as the
    // manual mark-paid action, and a later correcting payment row also re-ran
    // it (audit P2/P7) — the claim makes the receipt+review bundle at-most-once
    // per invoice regardless of how many callers race. Zero rows = someone
    // else already claimed it. Tolerant of the column not existing yet
    // (pre-migration deploys proceed unclaimed rather than going silent).
    try {
      const { data: claimed, error: claimErr } = (await db
        .from("invoices")
        .update({ receipt_sent_at: new Date().toISOString() } as never)
        .eq("id", invoiceId)
        .is("receipt_sent_at" as never, null as never)
        .select("id")) as unknown as {
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      };
      if (!claimErr && (!claimed || claimed.length === 0)) {
        console.log(
          `[auto] autoOnInvoicePaid: invoice ${invoiceId} already handled — skipping`,
        );
        return;
      }
    } catch (claimEx) {
      console.error(
        "[auto] autoOnInvoicePaid claim step threw (proceeding unclaimed):",
        claimEx,
      );
    }

    const { data: orgData } = (await db
      .from("organizations")
      .select("name, brand_color, logo_url, timezone")
      .eq("id", invoice.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        name: string;
        brand_color: string | null;
        logo_url: string | null;
        timezone: string | null;
      } | null;
    };

    const orgName = orgData?.name ?? "Your service provider";
    const brandColor = orgData?.brand_color ?? undefined;
    const logoUrl = orgData?.logo_url ?? undefined;
    const orgTz = orgData?.timezone ?? "America/Edmonton";
    const currency = await getOrgCurrency(invoice.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    // A) Send payment receipt
    const receiptTemplate = paymentReceiptEmail({
      clientName: invoice.client.name ?? "there",
      orgName,
      invoiceNumber: invoice.number ?? invoiceId.slice(0, 8).toUpperCase(),
      amountFormatted: formatCurrencyCents(invoice.amount_cents, currency),
      paidDate: new Date(invoice.paid_at ?? new Date()).toLocaleDateString(
        "en-US",
        {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: orgTz,
        },
      ),
      publicUrl: invoice.public_token
        ? `${siteUrl}/i/${invoice.public_token}`
        : siteUrl,
      brandColor,
      logoUrl,
    });

    if (receiptEmail)
      await sendOrgEmail(invoice.organization_id, {
        to: invoice.client.email!,
        toName: invoice.client.name ?? undefined,
        ...receiptTemplate,
        pauseExempt: isInvoiceEmailUnpaused(),
      });

    // Receipt by text — independent channel; sendOrgSms applies its own
    // gates (per-key toggle, opt-in, cap, TWILIO_ENABLED).
    if (receiptSms) {
      try {
        const { sendOrgSms } = await import("@/lib/sms");
        const { composePaymentReceiptSms } = await import("@/lib/twilio");
        await sendOrgSms(invoice.organization_id, {
          to: billingDecision.clientPhone!,
          body: composePaymentReceiptSms({
            orgName,
            invoiceNumber:
              invoice.number ?? invoiceId.slice(0, 8).toUpperCase(),
            amountFormatted: formatCurrencyCents(
              invoice.amount_cents,
              currency,
            ),
          }),
          automationKey: "invoice_paid_receipt",
        });
      } catch (smsErr) {
        console.error("[auto] receipt SMS path errored:", invoiceId, smsErr);
      }
    }

    // B) Auto-generate review token and send review request
    // Check if review_token already exists
    const { data: existing } = (await db
      .from("invoices")
      .select("review_token")
      .eq("id", invoiceId)
      .maybeSingle()) as unknown as {
      data: { review_token: string | null } | null;
    };

    let reviewToken = existing?.review_token ?? null;
    if (!reviewToken) {
      reviewToken = generateClaimToken();
      await db
        .from("invoices")
        .update({ review_token: reviewToken })
        .eq("id", invoiceId);
    }

    const reviewTemplate = reviewRequestEmail({
      clientName: invoice.client.name ?? "there",
      orgName,
      reviewUrl: `${siteUrl}/review/${reviewToken}`,
      brandColor,
      logoUrl,
    });

    // Send review request immediately after the receipt. The "2-second
    // delay" was a setTimeout — which never fires in Vercel serverless
    // because the process terminates when the function returns. Back-to-back
    // Resend calls land in separate email threads in Gmail/Outlook anyway
    // (different Message-IDs), so there's no deliverability reason to delay.
    if (reviewEmail)
      await sendOrgEmail(invoice.organization_id, {
        to: invoice.client.email!,
        toName: invoice.client.name ?? undefined,
        ...reviewTemplate,
      });

    console.log(
      `[auto] Receipt + review request sent for invoice ${invoiceId}`,
    );
  } catch (err) {
    console.error("[auto] autoOnInvoicePaid failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 9. Notify admin(s) when a review is submitted
// ─────────────────────────────────────────────────────────────────

export async function notifyReviewSubmitted(
  organizationId: string,
  review: {
    rating: number;
    clientName: string;
    employeeName: string | null;
    reviewId: string;
    reviewText?: string | null;
  },
) {
  try {
    if (
      !(await isAutomationEnabled(organizationId, "review_submitted_notify"))
    ) {
      console.log(
        `[auto] Review submitted notify paused for org ${organizationId}`,
      );
      return;
    }

    const db = admin();
    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    const title = `New ${review.rating}-star review`;
    const body = `${review.clientName} left a ${stars} review${review.employeeName ? ` for ${review.employeeName}` : ""}.`;

    // Owner/admin-only — customer reviews are management-facing.
    await notifyOrgAdmins(organizationId, {
      title,
      body,
      href: "/app/reviews",
    }).catch(() => {});
    console.log(`[auto] Review notification sent for ${organizationId}`);

    // Email alert for low ratings (≤3★). Fires only when there's a real
    // service-recovery opportunity — not on every 4/5-star review.
    if (review.rating <= 3) {
      const enabled = await isAutomationEnabled(
        organizationId,
        "low_review_alert",
      );
      if (enabled) {
        const { sendEmail } = await import("@/lib/email");
        const { lowReviewAlertEmail } = await import("@/lib/email-templates");

        const { data: org } = (await db
          .from("organizations")
          .select("name")
          .eq("id", organizationId)
          .maybeSingle()) as unknown as {
          data: { name: string } | null;
        };
        const orgName = org?.name ?? "your organization";

        const recipients = await getOrgAdminRecipients(organizationId);
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
        for (const r of recipients) {
          const template = lowReviewAlertEmail({
            recipientName: r.fullName ?? "there",
            orgName,
            clientName: review.clientName,
            employeeName: review.employeeName,
            rating: review.rating,
            reviewText: review.reviewText ?? null,
            reviewUrl: `${siteUrl}/app/reviews`,
          });
          await sendEmail({
            to: r.email,
            toName: r.fullName ?? undefined,
            ...template,
          });
        }
        console.log(
          `[auto] Low review alert sent for ${organizationId} (rating ${review.rating})`,
        );
      }
    }
  } catch (err) {
    console.error("[auto] notifyReviewSubmitted failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 10. Auto-extend recurring booking series (called by cron)
// ─────────────────────────────────────────────────────────────────

export async function autoExtendRecurringSeries(): Promise<number> {
  try {
    const db = admin();
    const { generateOccurrences } = await import("@/lib/recurrence");
    const { createCalendarEvent } = await import("@/lib/google-calendar");

    // Find active series, filtering out any whose parent org has been
    // tombstoned by the purge flow. Otherwise the cron wastes cycles on
    // dead tenants and eventually tries to insert with FK violations.
    const { data: series } = (await db
      .from("booking_series")
      .select(`*, organization:organizations!inner(deleted_at)`)
      .eq("active", true)
      .is("organization.deleted_at", null)) as unknown as {
      data: Array<{
        id: string;
        organization_id: string;
        client_id: string;
        pattern: string;
        custom_days: number[] | null;
        monthly_nth: number | null;
        monthly_dow: number | null;
        start_time: string;
        starts_at: string;
        ends_at: string | null;
        generate_ahead: number;
        duration_minutes: number;
        service_type: string;
        // Migration 20260531010000 added these. Older series rows
        // backfilled from their latest live booking; new rows
        // populate them at create time.
        service_type_id: string | null;
        service_type_label: string | null;
        package_id: string | null;
        assigned_to: string | null;
        total_cents: number;
        hourly_rate_cents: number | null;
        address: string | null;
        notes: string | null;
        skip_dates: string[] | null;
      }> | null;
    };

    if (!series || series.length === 0) return 0;

    let totalGenerated = 0;

    for (const s of series) {
      // Find the latest LIVE booking in this series. Excluding archived
      // rows is critical: if the last sibling was just auto-archived (by
      // the housekeeping cron), this query would otherwise return that
      // stale row, see its date as "the latest", and either skip
      // generation (false sense of being caught-up) or duplicate.
      const { data: latest } = await db
        .from("bookings")
        .select("scheduled_at")
        .eq("series_id", s.id)
        .is("archived_at", null)
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latest) continue;

      const latestDate = new Date(latest.scheduled_at);
      const replenishThreshold = new Date();
      replenishThreshold.setDate(replenishThreshold.getDate() + 30);

      // If the latest booking is more than 30 days out, no need to generate
      if (latestDate > replenishThreshold) continue;

      // Generate next batch (honoring skip_dates and the org's timezone
      // so DST shifts + holidays don't silently drift the schedule).
      const { getOrgTimezone } = await import("@/lib/org-timezone");
      const orgTz = await getOrgTimezone(s.organization_id);
      const occurrences = generateOccurrences(
        {
          pattern: s.pattern as import("@/lib/recurrence").RecurrencePattern,
          custom_days: s.custom_days,
          monthly_nth: s.monthly_nth,
          monthly_dow: s.monthly_dow,
          start_time: s.start_time,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          generate_ahead: s.generate_ahead,
          skip_dates: s.skip_dates,
          tz: orgTz,
        },
        s.generate_ahead,
        latestDate,
      );

      if (occurrences.length === 0) continue;

      const rows = occurrences.map((scheduled_at) => ({
        organization_id: s.organization_id,
        client_id: s.client_id,
        package_id: s.package_id,
        assigned_to: s.assigned_to,
        scheduled_at,
        duration_minutes: s.duration_minutes,
        service_type: s.service_type as ServiceTypeEnum,
        // Carry the FK + denormalized label forward so cron-generated
        // bookings display the org's custom service name (and not the
        // humanized enum). NULL when the series predates the migration
        // backfill — handled gracefully by the display layer's enum
        // fallback.
        service_type_id: s.service_type_id,
        service_type_label: s.service_type_label,
        status: "confirmed" as const,
        total_cents: s.total_cents,
        hourly_rate_cents: s.hourly_rate_cents,
        address: s.address,
        // The whole point of a series for a multi-property client: the
        // property is chosen once, here, and every generated booking inherits
        // it instead of someone retyping the address every week.
        property_id: (s as { property_id?: string | null }).property_id ?? null,
        notes: s.notes ? `[Recurring] ${s.notes}` : "[Recurring]",
        series_id: s.id,
      }));

      // Upsert with ignoreDuplicates against bookings_series_occurrence_uidx:
      // this cron racing itself (overlapping invocations) or a concurrent
      // series edit used to insert the same dates twice — two confirmed
      // visits, each auto-completing and auto-invoicing separately. Skipped
      // duplicates are excluded from `inserted`, so crew/calendar follow-ups
      // only run for rows this invocation actually created.
      const { data: inserted } = await (db
        .from("bookings")
        .upsert(rows, {
          onConflict: "series_id,scheduled_at",
          ignoreDuplicates: true,
        })
        .select("id, scheduled_at") as unknown as Promise<{
        data: Array<{ id: string; scheduled_at: string }> | null;
      }>);

      // Create the crew junction rows so generated occurrences actually show
      // up in the cleaner's field app (the field views read booking_assignees,
      // not bookings.assigned_to). Option 2: if the standing cleaner has
      // already confirmed this series, the new occurrences inherit 'accepted'
      // so they don't have to re-confirm every visit; otherwise 'pending'.
      if (inserted && inserted.length > 0 && s.assigned_to) {
        const { data: seriesBookings } = (await db
          .from("bookings")
          .select("id")
          .eq("series_id", s.id)
          .limit(2000)) as unknown as { data: Array<{ id: string }> | null };
        const seriesIds = (seriesBookings ?? []).map((b) => b.id);
        let seriesAccepted = false;
        if (seriesIds.length > 0) {
          const { count } = (await db
            .from("booking_assignees")
            .select("id", { count: "exact", head: true })
            .eq("membership_id", s.assigned_to)
            .eq("acceptance_status", "accepted")
            .in("booking_id", seriesIds)) as unknown as {
            count: number | null;
          };
          seriesAccepted = (count ?? 0) > 0;
        }
        const status = seriesAccepted ? "accepted" : "pending";
        const junctionRows = inserted.map((b) => ({
          organization_id: s.organization_id,
          booking_id: b.id,
          membership_id: s.assigned_to as string,
          is_primary: true,
          acceptance_status: status,
          responded_at: seriesAccepted ? new Date().toISOString() : null,
        }));
        await (db.from("booking_assignees").upsert(junctionRows, {
          onConflict: "booking_id,membership_id",
          ignoreDuplicates: true,
        }) as unknown as Promise<unknown>);
      }

      // Sync to calendar. Awaited (not fire-and-forget) so the cron's
      // serverless invocation doesn't freeze before the Google Calendar
      // writes complete — that left cron-extended occurrences with no
      // calendar event.
      if (inserted) {
        for (const b of inserted) {
          await createCalendarEvent(s.organization_id, {
            id: b.id,
            scheduled_at: b.scheduled_at,
            duration_minutes: s.duration_minutes,
            service_type: s.service_type,
            address: s.address,
            notes: s.notes,
            client_name: undefined,
            employee_name: undefined,
          }).catch(() => {});
        }
      }

      totalGenerated += occurrences.length;
      console.log(
        `[auto] Extended series ${s.id}: +${occurrences.length} bookings`,
      );
    }

    return totalGenerated;
  } catch (err) {
    console.error("[auto] autoExtendRecurringSeries failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// 11. Auto-compute review bonuses (called by weekly cron)
// ─────────────────────────────────────────────────────────────────

export async function autoComputeReviewBonuses(): Promise<number> {
  try {
    const db = admin();

    // Find every org with an enabled review bonus rule
    const { data: rules } = await db
      .from("bonus_rules")
      .select("*")
      .eq("enabled", true);

    if (!rules || rules.length === 0) return 0;

    let totalCreated = 0;

    for (const rule of rules) {
      const r = rule as {
        organization_id: string;
        period_days: number;
        min_avg_rating: number;
        min_reviews_count: number;
        amount_cents: number;
      };

      const periodEnd = new Date();
      const periodStart = new Date(periodEnd);
      periodStart.setUTCDate(periodStart.getUTCDate() - r.period_days);
      const periodStartIso = periodStart.toISOString();
      const periodStartDate = periodStartIso.slice(0, 10);
      const periodEndDate = periodEnd.toISOString().slice(0, 10);

      const { data: reviews } = await db
        .from("reviews")
        .select("employee_id, rating")
        .eq("organization_id", r.organization_id)
        .gte("submitted_at", periodStartIso)
        .not("employee_id", "is", null)
        .limit(5000);

      if (!reviews || reviews.length === 0) continue;

      const byEmployee = new Map<string, { sum: number; count: number }>();
      for (const rv of reviews) {
        if (!rv.employee_id) continue;
        const b = byEmployee.get(rv.employee_id) ?? { sum: 0, count: 0 };
        b.sum += rv.rating;
        b.count += 1;
        byEmployee.set(rv.employee_id, b);
      }

      // Dedupe by OVERLAP, not exact period dates. The period is a rolling
      // [now - period_days, now] window whose dates change every run, so an
      // exact-date match never hit and a qualifying employee was re-awarded
      // the same bonus every single cron run — real money weekly (audit T4).
      // Any existing review bonus whose period_end falls on/after this
      // window's start overlaps it (period_end is always <= award time).
      const { data: existing } = await db
        .from("bonuses")
        .select("employee_id")
        .eq("organization_id", r.organization_id)
        .eq("bonus_type", "review")
        .gte("period_end", periodStartDate);
      const alreadyAwarded = new Set(
        (existing ?? []).map((b) => b.employee_id),
      );

      const toCreate: BonusInsert[] = [];
      for (const [employeeId, bucket] of byEmployee.entries()) {
        if (bucket.count < r.min_reviews_count) continue;
        const avg = bucket.sum / bucket.count;
        if (avg < r.min_avg_rating) continue;
        if (alreadyAwarded.has(employeeId)) continue;

        toCreate.push({
          organization_id: r.organization_id,
          employee_id: employeeId,
          period_start: periodStartDate,
          period_end: periodEndDate,
          amount_cents: r.amount_cents,
          reason: `Avg ${avg.toFixed(2)} across ${bucket.count} reviews (last ${r.period_days}d)`,
          bonus_type: "review",
        });
      }

      if (toCreate.length > 0) {
        // The insert's verdict decides everything below — swallowing it
        // used to count the bonuses as created and tell the admins
        // "awarded" even when the write failed and no rows existed.
        const { error: bonusInsertErr } = await (db
          .from("bonuses")
          .insert(toCreate) as unknown as Promise<{
          error: { message: string } | null;
        }>);
        if (bonusInsertErr) {
          console.error(
            `[auto] review-bonus insert failed for org ${r.organization_id}:`,
            bonusInsertErr.message,
          );
          continue;
        }
        totalCreated += toCreate.length;

        // Owner/admin-only — payroll/bonus info is management-facing.
        await notifyOrgAdmins(r.organization_id, {
          title: "Bonuses computed",
          body: `${toCreate.length} new bonus${toCreate.length > 1 ? "es" : ""} awarded from recent reviews.`,
          href: "/app/bonuses",
        }).catch(() => {});
      }
    }

    return totalCreated;
  } catch (err) {
    console.error("[auto] autoComputeReviewBonuses failed:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// ADMIN AUTOMATIONS
//
// These email the owner/admin of an org, not the end client. They use
// sendEmail() directly (not sendOrgEmail), so the CLIENT_EMAILS_PAUSED
// kill switch does NOT silence them — that kill switch is scoped to
// org→client traffic only.
// ─────────────────────────────────────────────────────────────────

// 11. Unassigned booking alert — daily scan, silent when nothing to alert
export async function sendUnassignedBookingAlerts(): Promise<{
  orgsAlerted: number;
  bookingsFlagged: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { unassignedBookingAlertEmail } = await import("@/lib/email-templates");

  const now = Date.now();
  const windowEnd = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  const { data: rawCandidates } = (await db
    .from("bookings")
    .select(
      "id, organization_id, scheduled_at, service_type, service_type_label, address, client:clients ( name )",
    )
    .is("assigned_to", null)
    .is("unassigned_alert_sent_at", null)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", windowEnd)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      service_type: string;
      service_type_label: string | null;
      address: string | null;
      client: { name: string | null } | null;
    }> | null;
  };

  if (!rawCandidates || rawCandidates.length === 0) {
    return { orgsAlerted: 0, bookingsFlagged: 0 };
  }

  // CRITICAL FILTER: a booking can have assigned_to=NULL but still have a
  // full crew via booking_assignees (this is now the source of truth for
  // split-shift segment employees and additional crew). Without this
  // filter the cron sends false-positive "unassigned!" emails every day
  // for every split-shift booking in the org. Filter them out.
  // ...and a booking can ALSO be covered by a freelancer who claimed a bench
  // offer. That never writes bookings.assigned_to (freelancers aren't
  // memberships, and the column is a FK to memberships), so checking crew
  // alone still cried "unassigned!" about jobs that were fully staffed.
  const candidateIds = rawCandidates.map((b) => b.id);
  const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
  const coverage = await resolveBookingCoverage(candidateIds);
  const candidates = rawCandidates.filter((b) => !coverage.get(b.id)?.staffed);

  if (candidates.length === 0) {
    return { orgsAlerted: 0, bookingsFlagged: 0 };
  }

  // Group by org.
  const byOrg = new Map<string, typeof candidates>();
  for (const b of candidates) {
    const list = byOrg.get(b.organization_id) ?? [];
    list.push(b);
    byOrg.set(b.organization_id, list);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let orgsAlerted = 0;
  let bookingsFlagged = 0;

  for (const [orgId, bookings] of byOrg) {
    if (!(await isAutomationEnabled(orgId, "unassigned_booking_alert"))) {
      console.log(`[auto] Unassigned alert paused for org ${orgId}`);
      continue;
    }

    const { data: orgData } = (await db
      .from("organizations")
      .select("name, timezone")
      .eq("id", orgId)
      .maybeSingle()) as unknown as {
      data: { name: string; timezone: string | null } | null;
    };
    const orgName = orgData?.name ?? "your organization";
    const orgTz = orgData?.timezone ?? "America/Edmonton";

    const recipients = await getOrgAdminRecipients(orgId);
    if (recipients.length === 0) continue;

    const bookingRows = bookings.map((b) => ({
      clientName: b.client?.name ?? "A client",
      serviceName: b.service_type_label ?? humanize(b.service_type),
      dateTime: new Date(b.scheduled_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: orgTz,
      }),
      address: b.address ?? "(no address)",
      hoursUntil: Math.max(
        1,
        Math.round(
          (new Date(b.scheduled_at).getTime() - now) / (60 * 60 * 1000),
        ),
      ),
    }));

    for (const r of recipients) {
      const template = unassignedBookingAlertEmail({
        recipientName: r.fullName ?? "there",
        orgName,
        dashboardUrl: `${siteUrl}/app/bookings`,
        bookings: bookingRows,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    // Stamp each booking so we don't re-alert; the trigger clears it
    // automatically if the booking later gets an assignee.
    await db
      .from("bookings")
      .update({ unassigned_alert_sent_at: new Date().toISOString() })
      .in(
        "id",
        bookings.map((b) => b.id),
      );

    orgsAlerted += 1;
    bookingsFlagged += bookings.length;
    console.log(
      `[auto] Unassigned alert sent for org ${orgId}: ${bookings.length} booking(s)`,
    );
  }

  return { orgsAlerted, bookingsFlagged };
}

// ─────────────────────────────────────────────────────────────────
// 12. Stripe payout notification — called from the Connect webhook
// ─────────────────────────────────────────────────────────────────

export async function sendPayoutNotification(args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  arrivalDateUnix: number | null;
  payoutId: string;
}): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { stripePayoutAlertEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");

    const { data: org } = (await db
      .from("organizations")
      .select("id, name")
      .eq("stripe_account_id", args.stripeAccountId)
      .maybeSingle()) as unknown as {
      data: { id: string; name: string } | null;
    };

    if (!org) {
      console.warn(
        `[auto] Payout for unknown Connect account ${args.stripeAccountId}`,
      );
      return;
    }

    if (!(await isAutomationEnabled(org.id, "stripe_payout_alert"))) {
      console.log(`[auto] Payout alert paused for org ${org.id}`);
      return;
    }

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) return;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const { getOrgTimezone: getPayoutTz } = await import("@/lib/org-timezone");
    const payoutTz = await getPayoutTz(org.id);
    const arrivalDate = args.arrivalDateUnix
      ? new Date(args.arrivalDateUnix * 1000).toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: payoutTz,
        })
      : "soon";

    // Stripe currencies are ISO 4217 lowercase; our formatter expects uppercase.
    const ccy = args.currency.toUpperCase();
    const formattable = ccy === "CAD" || ccy === "USD" ? ccy : "USD";
    const amount = formatCurrencyCents(
      args.amountCents,
      formattable as "CAD" | "USD",
    );

    for (const r of recipients) {
      const template = stripePayoutAlertEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        amountFormatted: amount,
        arrivalDate,
        payoutId: args.payoutId,
        dashboardUrl: `${siteUrl}/app/settings/integrations`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    console.log(
      `[auto] Payout alert sent for org ${org.id}: ${amount} (${args.payoutId})`,
    );
  } catch (err) {
    console.error("[auto] sendPayoutNotification failed:", err);
  }
}

/**
 * Notify the org owner(s) that their PLATFORM-level Sollos subscription
 * had a failed payment. Stripe will keep retrying for several days
 * before suspending the subscription — we send an immediate email so
 * the owner can update their card before they lose access.
 *
 * Called from the billing webhook on invoice.payment_failed.
 */
export async function notifyPlatformPaymentFailed(
  stripeSubscriptionId: string,
): Promise<void> {
  try {
    const db = admin();

    // Resolve the subscription row → org.
    const { data: sub } = (await db
      .from("subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .maybeSingle()) as unknown as {
      data: { organization_id: string } | null;
    };
    if (!sub) {
      console.warn(
        `[auto] payment_failed for unknown stripe sub ${stripeSubscriptionId}`,
      );
      return;
    }

    const { data: org } = (await db
      .from("organizations")
      .select("name")
      .eq("id", sub.organization_id)
      .maybeSingle()) as unknown as {
      data: { name: string } | null;
    };

    const recipients = await getOrgAdminRecipients(sub.organization_id);
    if (recipients.length === 0) return;

    const { sendEmail } = await import("@/lib/email");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const billingUrl = `${siteUrl}/app/settings/billing`;
    const orgName = org?.name ?? "your team";

    // Lightweight inline template — no need to round-trip a new
    // email-template export for a one-paragraph notice.
    for (const r of recipients) {
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        subject: `Action needed: your Sollos payment didn't go through`,
        html:
          `<p>Hi ${r.fullName ?? "there"},</p>` +
          `<p>We just received a notice from Stripe that your most recent ` +
          `payment for <strong>${orgName}</strong> failed.</p>` +
          `<p>Stripe will automatically retry over the next few days. ` +
          `To avoid interruption, please update your payment method:</p>` +
          `<p><a href="${billingUrl}">Update billing</a></p>` +
          `<p>If you've already updated it, you can ignore this email — ` +
          `the next retry will pick up the new card.</p>`,
        text:
          `Hi ${r.fullName ?? "there"},\n\n` +
          `Your most recent Sollos payment for ${orgName} failed. ` +
          `Stripe will retry over the next few days. To avoid interruption, ` +
          `update your card at ${billingUrl}.`,
      });
    }
    console.log(
      `[auto] payment_failed notification sent for org ${sub.organization_id}`,
    );
  } catch (err) {
    console.error("[auto] notifyPlatformPaymentFailed error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// 13. Weekly ops digest — Monday 8:00 UTC
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// 13b. Morning invoice review digest — daily, before the send hour
//
// The heads-up half of the "silence is consent" invoice flow: every
// morning the owner/admins get yesterday's completed jobs and the
// drafts auto-sending later today, so anything wrong gets fixed or
// held BEFORE it emails a client. No action needed on a clean day.
//
// Sends nothing when there were no completed jobs yesterday AND no
// sends scheduled today — an empty digest trains people to ignore it.
// ─────────────────────────────────────────────────────────────────
export async function sendInvoiceReviewDigests(): Promise<{
  orgsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { invoiceReviewDigestEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents, FALLBACK_TZ } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");
  const { isValidIanaTz } = await import("@/lib/org-timezone");
  const { zonedDayBoundsUtc, formatHourLabel } =
    await import("@/lib/wall-clock");

  const now = new Date();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  const { data: orgs } = (await db
    .from("organizations")
    .select(
      "id, name, timezone, invoice_auto_send_enabled, invoice_auto_send_hour",
    )
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      name: string;
      timezone: string | null;
      invoice_auto_send_enabled: boolean | null;
      invoice_auto_send_hour: number | null;
    }> | null;
  };
  if (!orgs) return { orgsSent: 0 };

  let orgsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "invoice_review_digest"))) continue;

    const tz =
      org.timezone && isValidIanaTz(org.timezone) ? org.timezone : FALLBACK_TZ;
    const yesterday = zonedDayBoundsUtc(now, tz, -1);
    const today = zonedDayBoundsUtc(now, tz, 0);

    // Yesterday's completed jobs + the drafts queued to send today.
    const [{ data: doneBookings }, { data: outgoingInvoices }] =
      await Promise.all([
        db
          .from("bookings")
          .select("id, scheduled_at, client:clients ( name )")
          .eq("organization_id", org.id)
          .eq("status", "completed")
          .gte("scheduled_at", yesterday.start.toISOString())
          .lt("scheduled_at", yesterday.end.toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(50) as unknown as Promise<{
          data: Array<{
            id: string;
            scheduled_at: string;
            client: { name: string | null } | null;
          }> | null;
        }>,
        db
          .from("invoices")
          .select(
            "id, number, amount_cents, booking_id, client:clients ( name )",
          )
          .eq("organization_id", org.id)
          .eq("status", "draft")
          .eq("auto_send_state" as never, "scheduled" as never)
          .gte("auto_send_at" as never, today.start.toISOString() as never)
          .lt("auto_send_at" as never, today.end.toISOString() as never)
          .limit(50) as unknown as Promise<{
          data: Array<{
            id: string;
            number: string | null;
            amount_cents: number;
            booking_id: string | null;
            client: { name: string | null } | null;
          }> | null;
        }>,
      ]);

    const jobs = doneBookings ?? [];
    const outgoing = outgoingInvoices ?? [];
    if (jobs.length === 0 && outgoing.length === 0) continue;

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) continue;

    const currency = await getOrgCurrency(org.id);

    // Per-job invoice outcome, so the jobs list answers "did this bill?".
    const { data: jobInvoices } = (await db
      .from("invoices")
      .select("booking_id, number, amount_cents, status")
      .eq("organization_id", org.id)
      .in(
        "booking_id",
        jobs.map((b) => b.id),
      )) as unknown as {
      data: Array<{
        booking_id: string | null;
        number: string | null;
        amount_cents: number;
        status: string;
      }> | null;
    };
    const invoiceByBooking = new Map(
      (jobInvoices ?? [])
        .filter((i) => i.booking_id)
        .map((i) => [i.booking_id as string, i]),
    );

    const dayLabel = yesterday.start.toLocaleDateString("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const sendTimeLabel = org.invoice_auto_send_enabled
      ? formatHourLabel(
          typeof org.invoice_auto_send_hour === "number"
            ? org.invoice_auto_send_hour
            : 17,
        )
      : null;

    const jobItems = jobs.map((b) => {
      const inv = invoiceByBooking.get(b.id);
      return {
        clientName: b.client?.name ?? "Client",
        timeLabel: new Date(b.scheduled_at).toLocaleTimeString("en-US", {
          timeZone: tz,
          hour: "numeric",
          minute: "2-digit",
        }),
        invoiceLabel: inv
          ? `${inv.number ? `#${inv.number} · ` : ""}${formatCurrencyCents(inv.amount_cents, currency)} (${inv.status})`
          : "No per-job invoice (billed on cycle, or drafting off)",
      };
    });
    const outgoingItems = outgoing.map((i) => ({
      clientName: i.client?.name ?? "Client",
      amountLabel: formatCurrencyCents(i.amount_cents, currency),
      detail: i.number ? `Invoice #${i.number}` : "Draft invoice",
    }));

    for (const r of recipients) {
      const template = invoiceReviewDigestEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        dayLabel,
        jobs: jobItems,
        outgoing: outgoingItems,
        sendTimeLabel,
        invoicesUrl: `${siteUrl}/app/invoices`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    orgsSent += 1;
    console.log(`[auto] Invoice review digest sent for org ${org.id}`);
  }

  return { orgsSent };
}

export async function sendWeeklyOpsDigests(): Promise<{
  orgsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { weeklyOpsDigestEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  const now = new Date();
  // Last 7 days, ending at "now" (which is ~Monday morning when the cron fires).
  const end = new Date(now);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, name, timezone")
    .is("deleted_at", null)) as unknown as {
    data: Array<{ id: string; name: string; timezone: string | null }> | null;
  };

  if (!orgs) return { orgsSent: 0 };

  let orgsSent = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "weekly_ops_digest"))) continue;

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) continue;

    // Label the week in the org's calendar, not the server's — rendering
    // these instants with UTC's date shifts the whole label a day off for
    // timezones where the cron hour lands on a different local date.
    const orgTz = org.timezone ?? "America/Edmonton";
    const weekLabel = `${start.toLocaleDateString("en-US", { timeZone: orgTz, month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { timeZone: orgTz, month: "short", day: "numeric", year: "numeric" })}`;

    // Gather stats in parallel.
    const [
      { data: paidInvoices },
      { data: prevPaidInvoices },
      { count: completedCount },
      { count: cancelledCount },
      { data: reviews },
      { count: overdueCount },
      { data: unassignedUpcomingRows },
    ] = await Promise.all([
      db
        .from("invoices")
        .select("amount_cents")
        .eq("organization_id", org.id)
        .gte("paid_at", start.toISOString())
        .lte("paid_at", end.toISOString()) as unknown as Promise<{
        data: Array<{ amount_cents: number }> | null;
      }>,
      db
        .from("invoices")
        .select("amount_cents")
        .eq("organization_id", org.id)
        .gte("paid_at", prevStart.toISOString())
        .lte("paid_at", start.toISOString()) as unknown as Promise<{
        data: Array<{ amount_cents: number }> | null;
      }>,
      db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .eq("status", "completed")
        .gte("scheduled_at", start.toISOString())
        .lte("scheduled_at", end.toISOString()),
      db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .eq("status", "cancelled")
        .gte("updated_at", start.toISOString())
        .lte("updated_at", end.toISOString()),
      db
        .from("reviews")
        .select("rating")
        .eq("organization_id", org.id)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString()) as unknown as Promise<{
        data: Array<{ rating: number }> | null;
      }>,
      db
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .eq("status", "overdue")
        .is("paid_at", null),
      // Rows, not a count — a bench claim never sets assigned_to, so counting
      // on that column alone reported covered jobs as unstaffed in the digest.
      db
        .from("bookings")
        .select("id")
        .eq("organization_id", org.id)
        .is("assigned_to", null)
        .in("status", ["pending", "confirmed"])
        .gte("scheduled_at", now.toISOString())
        .lte(
          "scheduled_at",
          new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        )
        .limit(200),
    ]);

    // Drop jobs a bench freelancer already claimed — they aren't unstaffed.
    const { resolveBookingCoverage: coverFor } =
      await import("@/lib/booking-coverage");
    const upcomingCov = await coverFor(
      ((unassignedUpcomingRows ?? []) as Array<{ id: string }>).map(
        (b) => b.id,
      ),
    );
    const unassignedUpcoming = (
      (unassignedUpcomingRows ?? []) as Array<{ id: string }>
    ).filter((b) => !upcomingCov.get(b.id)?.staffed).length;

    const revenueCents = (paidInvoices ?? []).reduce(
      (acc, r) => acc + r.amount_cents,
      0,
    );
    const prevRevenueCents = (prevPaidInvoices ?? []).reduce(
      (acc, r) => acc + r.amount_cents,
      0,
    );
    const deltaPct =
      prevRevenueCents > 0
        ? Math.round(
            ((revenueCents - prevRevenueCents) / prevRevenueCents) * 100,
          )
        : null;

    const avgRating =
      reviews && reviews.length > 0
        ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(
            1,
          )
        : null;

    const currency = await getOrgCurrency(org.id);

    const stats = [
      {
        label: "Revenue",
        value: formatCurrencyCents(revenueCents, currency),
        sub:
          deltaPct !== null
            ? `${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs prior week`
            : "No prior-week baseline",
      },
      {
        label: "Jobs completed",
        value: String(completedCount ?? 0),
      },
      {
        label: "Jobs cancelled",
        value: String(cancelledCount ?? 0),
      },
      {
        label: "Avg rating",
        value: avgRating ? `${avgRating} ★` : "—",
        sub:
          reviews && reviews.length > 0
            ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
            : "No reviews this week",
      },
      {
        label: "Overdue invoices",
        value: String(overdueCount ?? 0),
      },
    ];

    for (const r of recipients) {
      const template = weeklyOpsDigestEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        weekLabel,
        stats,
        upcomingUnassigned: unassignedUpcoming,
        dashboardUrl: `${siteUrl}/app/reports`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    orgsSent += 1;
    console.log(`[auto] Weekly digest sent for org ${org.id}`);
  }

  return { orgsSent };
}

// ─────────────────────────────────────────────────────────────────
// 14. Monthly ops digest — 1st of month, 9:00 UTC
// ─────────────────────────────────────────────────────────────────

export async function sendMonthlyOpsDigests(): Promise<{ orgsSent: number }> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { monthlyOpsDigestEmail } = await import("@/lib/email-templates");
  const { formatCurrencyCents } = await import("@/lib/format");
  const { getOrgCurrency } = await import("@/lib/org-currency");

  // Run window: prior calendar month UTC. If today is Nov 1, window is
  // Oct 1 00:00 UTC through Nov 1 00:00 UTC.
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const monthLabel = start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, name")
    .is("deleted_at", null)) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  if (!orgs) return { orgsSent: 0 };

  let orgsSent = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "monthly_ops_digest"))) continue;

    const recipients = await getOrgAdminRecipients(org.id);
    if (recipients.length === 0) continue;

    const [
      { data: paidInvoices },
      { count: completedCount },
      { count: cancelledCount },
      { data: reviews },
      { count: newClientsCount },
    ] = await Promise.all([
      db
        .from("invoices")
        .select("amount_cents, client_id, client:clients ( name )")
        .eq("organization_id", org.id)
        .gte("paid_at", start.toISOString())
        .lt("paid_at", end.toISOString()) as unknown as Promise<{
        data: Array<{
          amount_cents: number;
          client_id: string;
          client: { name: string | null } | null;
        }> | null;
      }>,
      db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .eq("status", "completed")
        .gte("scheduled_at", start.toISOString())
        .lt("scheduled_at", end.toISOString()),
      db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .eq("status", "cancelled")
        .gte("updated_at", start.toISOString())
        .lt("updated_at", end.toISOString()),
      db
        .from("reviews")
        .select("rating")
        .eq("organization_id", org.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()) as unknown as Promise<{
        data: Array<{ rating: number }> | null;
      }>,
      db
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()),
    ]);

    // Aggregate top clients by revenue.
    const clientAgg = new Map<
      string,
      { name: string; cents: number; jobs: number }
    >();
    for (const inv of paidInvoices ?? []) {
      const existing = clientAgg.get(inv.client_id) ?? {
        name: inv.client?.name ?? "—",
        cents: 0,
        jobs: 0,
      };
      existing.cents += inv.amount_cents;
      existing.jobs += 1;
      clientAgg.set(inv.client_id, existing);
    }
    const topClients = [...clientAgg.values()]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 3);

    const currency = await getOrgCurrency(org.id);

    // Top performer by completed jobs.
    const { data: completedByEmp } = (await db
      .from("bookings")
      .select("assigned_to")
      .eq("organization_id", org.id)
      .eq("status", "completed")
      .not("assigned_to", "is", null)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())) as unknown as {
      data: Array<{ assigned_to: string }> | null;
    };
    const empCount = new Map<string, number>();
    for (const b of completedByEmp ?? []) {
      empCount.set(b.assigned_to, (empCount.get(b.assigned_to) ?? 0) + 1);
    }
    let topEmployee: { name: string; jobs: number } | null = null;
    if (empCount.size > 0) {
      const [topId, jobs] = [...empCount.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      const { data: m } = (await db
        .from("memberships")
        .select("profile:profiles ( full_name )")
        .eq("id", topId)
        .maybeSingle()) as unknown as {
        data: { profile: { full_name: string | null } | null } | null;
      };
      topEmployee = {
        name: m?.profile?.full_name ?? "Top cleaner",
        jobs,
      };
    }

    const revenueCents = (paidInvoices ?? []).reduce(
      (a, r) => a + r.amount_cents,
      0,
    );
    const avgRating =
      reviews && reviews.length > 0
        ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(
            1,
          )
        : null;

    const stats = [
      { label: "Revenue", value: formatCurrencyCents(revenueCents, currency) },
      { label: "Jobs completed", value: String(completedCount ?? 0) },
      { label: "Jobs cancelled", value: String(cancelledCount ?? 0) },
      {
        label: "Avg rating",
        value: avgRating ? `${avgRating} ★` : "—",
        sub:
          reviews && reviews.length > 0
            ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
            : undefined,
      },
      { label: "New clients", value: String(newClientsCount ?? 0) },
    ];

    for (const r of recipients) {
      const template = monthlyOpsDigestEmail({
        recipientName: r.fullName ?? "there",
        orgName: org.name,
        monthLabel,
        stats,
        topClients: topClients.map((c) => ({
          name: c.name,
          revenue: formatCurrencyCents(c.cents, currency),
          jobs: c.jobs,
        })),
        topEmployee,
        dashboardUrl: `${siteUrl}/app/reports`,
      });
      await sendEmail({
        to: r.email,
        toName: r.fullName ?? undefined,
        ...template,
      });
    }

    orgsSent += 1;
    console.log(`[auto] Monthly digest sent for org ${org.id}`);
  }

  return { orgsSent };
}

// ─────────────────────────────────────────────────────────────────
// EMPLOYEE AUTOMATIONS
//
// All employee-facing, so they use sendEmail() directly. The
// CLIENT_EMAILS_PAUSED kill switch does NOT silence these — that
// kill switch is scoped to org→client only.
// ─────────────────────────────────────────────────────────────────

// ── Split-shift aware crew resolution ──────────────────────────────
// booking_assignees is the source of truth for who works a job and,
// for split shifts, which segment each person covers. These helpers let
// the schedule emails (a) reach EVERY assignee, not just the forced
// segment-0 employee in bookings.assigned_to, and (b) render each
// person's OWN window for a split rather than the whole-booking time.

type SegRow = {
  booking_id: string;
  membership_id: string;
  is_primary: boolean;
  split_start_offset_minutes: number | null;
  split_duration_minutes: number | null;
};

// Fetch assignee rows + a membership_id→display-name map for a set of
// bookings. The name map feeds split handoff labels ("Ana takes over…").
async function loadCrewForBookings(
  db: ReturnType<typeof admin>,
  bookingIds: string[],
): Promise<{
  rowsByBooking: Map<string, SegRow[]>;
  nameById: Map<string, string>;
}> {
  const rowsByBooking = new Map<string, SegRow[]>();
  const nameById = new Map<string, string>();
  if (bookingIds.length === 0) return { rowsByBooking, nameById };

  const { data: assigneeRows } = (await db
    .from("booking_assignees")
    .select(
      "booking_id, membership_id, is_primary, split_start_offset_minutes, split_duration_minutes",
    )
    .in("booking_id", bookingIds)) as unknown as {
    data: SegRow[] | null;
  };

  for (const r of assigneeRows ?? []) {
    const arr = rowsByBooking.get(r.booking_id) ?? [];
    arr.push(r);
    rowsByBooking.set(r.booking_id, arr);
  }

  const memberIds = [
    ...new Set((assigneeRows ?? []).map((r) => r.membership_id)),
  ];
  if (memberIds.length > 0) {
    const { data: memberRows } = (await db
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .in("id", memberIds)) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    for (const m of memberRows ?? []) {
      nameById.set(
        m.id,
        m.display_name ?? m.profile?.full_name ?? "A teammate",
      );
    }
  }

  return { rowsByBooking, nameById };
}

// Resolve the window THIS employee actually works on a booking. For a
// split shift it's their segment (booking start + offset, segment
// duration); otherwise it's the whole booking. Also returns a handoff
// label naming the cleaner immediately before/after them.
function employeeShiftWindow(args: {
  bookingStart: string;
  bookingDurationMinutes: number;
  row: SegRow;
  bookingSegments: SegRow[];
  nameById: Map<string, string>;
  tz: string;
}): {
  start: Date;
  durationMinutes: number;
  isSplit: boolean;
  windowLabel: string | null;
  handoffLabel: string | null;
} {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: args.tz,
    });

  const segs = args.bookingSegments
    .filter(
      (s) =>
        s.split_start_offset_minutes != null &&
        s.split_duration_minutes != null,
    )
    .sort(
      (a, b) =>
        (a.split_start_offset_minutes ?? 0) -
        (b.split_start_offset_minutes ?? 0),
    );

  const bookingStartDate = new Date(args.bookingStart);
  const isSplit = segs.length >= 2;

  if (
    !isSplit ||
    args.row.split_start_offset_minutes == null ||
    args.row.split_duration_minutes == null
  ) {
    return {
      start: bookingStartDate,
      durationMinutes: args.bookingDurationMinutes,
      isSplit: false,
      windowLabel: null,
      handoffLabel: null,
    };
  }

  const start = new Date(
    bookingStartDate.getTime() + args.row.split_start_offset_minutes * 60000,
  );
  const durationMinutes = args.row.split_duration_minutes;
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const myIdx = segs.findIndex(
    (s) =>
      s.membership_id === args.row.membership_id &&
      s.split_start_offset_minutes === args.row.split_start_offset_minutes,
  );
  const next = myIdx >= 0 ? segs[myIdx + 1] : undefined;
  const prev = myIdx > 0 ? segs[myIdx - 1] : undefined;

  let handoffLabel: string | null = null;
  if (next) {
    handoffLabel = `${args.nameById.get(next.membership_id) ?? "The next cleaner"} takes over at ${fmt(end)}`;
  } else if (prev) {
    handoffLabel = `You take over from ${args.nameById.get(prev.membership_id) ?? "the previous cleaner"} at ${fmt(start)}`;
  }

  return {
    start,
    durationMinutes,
    isSplit: true,
    windowLabel: `${fmt(start)} – ${fmt(end)}`,
    handoffLabel,
  };
}

// Build the effective per-employee assignment list for a set of
// bookings: one entry per (booking, assignee). Falls back to
// bookings.assigned_to for legacy bookings that predate booking_assignees
// so nobody silently drops off the schedule email.
function effectiveAssignments<
  B extends { id: string; assigned_to: string | null },
>(
  bookings: B[],
  rowsByBooking: Map<string, SegRow[]>,
): Array<{ booking: B; row: SegRow }> {
  const out: Array<{ booking: B; row: SegRow }> = [];
  for (const b of bookings) {
    const rows = rowsByBooking.get(b.id);
    if (rows && rows.length > 0) {
      for (const r of rows) out.push({ booking: b, row: r });
    } else if (b.assigned_to) {
      out.push({
        booking: b,
        row: {
          booking_id: b.id,
          membership_id: b.assigned_to,
          is_primary: true,
          split_start_offset_minutes: null,
          split_duration_minutes: null,
        },
      });
    }
  }
  return out;
}

// 15. Daily employee schedule email (cron at 06:00 UTC)
export async function sendDailyEmployeeSchedules(): Promise<{
  emailsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeDailyScheduleEmail } = await import("@/lib/email-templates");

  const now = new Date();

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, name, timezone")
    .is("deleted_at", null)) as unknown as {
    data: Array<{ id: string; name: string; timezone: string | null }> | null;
  };

  if (!orgs) return { emailsSent: 0 };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let emailsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "employee_daily_schedule")))
      continue;
    const orgTz = org.timezone ?? "America/Edmonton";

    // "Today" must be the org's LOCAL calendar day, not a UTC day. Using a UTC
    // window dropped evening jobs (and pulled in the prior evening's) for
    // negative-offset orgs. Compute the UTC instants that bound local midnight.
    const localToday = now.toLocaleDateString("en-CA", { timeZone: orgTz }); // YYYY-MM-DD
    const startOfDay = new Date(
      localInputToUtcIso(`${localToday}T00:00`, orgTz),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const { data: bookings } = (await db
      .from("bookings")
      .select(
        `
        id, scheduled_at, service_type, service_type_label, duration_minutes, address, notes,
        assigned_to,
        client:clients ( name, address )
      `,
      )
      .eq("organization_id", org.id)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", startOfDay.toISOString())
      .lt("scheduled_at", endOfDay.toISOString())
      .order("scheduled_at")) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        duration_minutes: number;
        address: string | null;
        notes: string | null;
        assigned_to: string | null;
        client: { name: string | null; address: string | null } | null;
      }> | null;
    };

    if (!bookings || bookings.length === 0) continue;

    // Resolve crew + split segments from the junction table, then build
    // one entry per (booking, assignee). This reaches every cleaner on a
    // job — not just bookings.assigned_to — and lets us render each
    // person's own segment for split shifts.
    const { rowsByBooking, nameById } = await loadCrewForBookings(
      db,
      bookings.map((b) => b.id),
    );
    const assignments = effectiveAssignments(bookings, rowsByBooking);

    const byEmployee = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const list = byEmployee.get(a.row.membership_id) ?? [];
      list.push(a);
      byEmployee.set(a.row.membership_id, list);
    }

    for (const [membershipId, items] of byEmployee) {
      const recipient = await getMembershipRecipient(membershipId);
      if (!recipient) continue;

      // Order each employee's jobs by their OWN segment start, not the
      // booking start — otherwise a late split segment sorts wrong.
      const jobs = items
        .map(({ booking, row }) => {
          const win = employeeShiftWindow({
            bookingStart: booking.scheduled_at,
            bookingDurationMinutes: booking.duration_minutes,
            row,
            bookingSegments: rowsByBooking.get(booking.id) ?? [],
            nameById,
            tz: orgTz,
          });
          return { booking, win };
        })
        .sort((a, b) => a.win.start.getTime() - b.win.start.getTime())
        .map(({ booking, win }) => ({
          time: win.start.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: orgTz,
          }),
          serviceName:
            booking.service_type_label ?? humanize(booking.service_type),
          clientName: booking.client?.name ?? "A client",
          address:
            booking.address ?? booking.client?.address ?? "(address on file)",
          durationLabel:
            win.durationMinutes >= 60
              ? `${Math.round((win.durationMinutes / 60) * 10) / 10}h`
              : `${win.durationMinutes}m`,
          notes: booking.notes,
          windowLabel: win.windowLabel,
          handoffLabel: win.handoffLabel,
        }));

      const template = employeeDailyScheduleEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org.name,
        dateLabel: startOfDay.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: orgTz,
        }),
        jobs,
        fieldAppUrl: `${siteUrl}/field/jobs`,
      });

      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
      emailsSent += 1;
    }

    console.log(`[auto] Daily schedule emails sent for org ${org.id}`);
  }

  return { emailsSent };
}

// 16. Weekly employee schedule email (cron Sunday 18:00 UTC)
export async function sendWeeklyEmployeeSchedules(): Promise<{
  emailsSent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeWeeklyScheduleEmail } = await import("@/lib/email-templates");
  const { zonedDayStartUtc } = await import("@/lib/wall-clock");

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, name, timezone")
    .is("deleted_at", null)) as unknown as {
    data: Array<{ id: string; name: string; timezone: string | null }> | null;
  };

  if (!orgs) return { emailsSent: 0 };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let emailsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "employee_weekly_schedule")))
      continue;
    const orgTz = org.timezone ?? "America/Edmonton";

    // The next 7 days in the ORG's calendar, not UTC's. These three were
    // computed once above the loop from UTC midnight, so for a negative-offset
    // org the "week" ran Sunday 18:00 to Sunday 18:00 local — and every job
    // after 6 PM on the closing Sunday fell outside the query entirely. Not
    // mislabelled: absent. A job missing from a schedule email is a no-show.
    const startOfTomorrow = zonedDayStartUtc(new Date(), orgTz, 1);
    const endOfWeek = zonedDayStartUtc(new Date(), orgTz, 8);
    const labelDay = (d: Date) =>
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: orgTz,
      });
    const weekLabel = `${labelDay(startOfTomorrow)} – ${labelDay(new Date(endOfWeek.getTime() - 1))}`;

    const { data: bookings } = (await db
      .from("bookings")
      .select(
        `
        id, scheduled_at, service_type, service_type_label, duration_minutes, assigned_to,
        client:clients ( name )
      `,
      )
      .eq("organization_id", org.id)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", startOfTomorrow.toISOString())
      .lt("scheduled_at", endOfWeek.toISOString())
      .order("scheduled_at")) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        service_type: string;
        service_type_label: string | null;
        duration_minutes: number;
        assigned_to: string | null;
        client: { name: string | null } | null;
      }> | null;
    };

    if (!bookings) continue;

    // Crew + split segments, then one entry per (booking, assignee) so
    // every cleaner gets their week — and split shifts show each person's
    // own segment start.
    const { rowsByBooking, nameById } = await loadCrewForBookings(
      db,
      bookings.map((b) => b.id),
    );
    const assignments = effectiveAssignments(bookings, rowsByBooking);

    const byEmployee = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const list = byEmployee.get(a.row.membership_id) ?? [];
      list.push(a);
      byEmployee.set(a.row.membership_id, list);
    }

    for (const [membershipId, items] of byEmployee) {
      if (items.length === 0) continue;
      const recipient = await getMembershipRecipient(membershipId);
      if (!recipient) continue;

      // Resolve each assignment to this employee's actual window first,
      // so day-bucketing and times use their segment, not the booking.
      const resolved = items.map(({ booking, row }) => ({
        booking,
        win: employeeShiftWindow({
          bookingStart: booking.scheduled_at,
          bookingDurationMinutes: booking.duration_minutes,
          row,
          bookingSegments: rowsByBooking.get(booking.id) ?? [],
          nameById,
          tz: orgTz,
        }),
      }));

      // Bucket into 7 day bins using the org's local date, not UTC date.
      // Without this, a job at 10 PM local time (= next UTC day) ends up in
      // the wrong bucket when the server runs in UTC.
      const dayMap = new Map<string, typeof resolved>();
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(startOfTomorrow.getTime() + i * 24 * 60 * 60 * 1000);
        const localKey = d.toLocaleDateString("en-CA", { timeZone: orgTz }); // YYYY-MM-DD
        dayMap.set(localKey, []);
      }
      for (const r of resolved) {
        const localKey = r.win.start.toLocaleDateString("en-CA", {
          timeZone: orgTz,
        });
        const bucket = dayMap.get(localKey) ?? [];
        bucket.push(r);
        dayMap.set(localKey, bucket);
      }

      const days = [...dayMap.entries()].map(([key, jobsOfDay]) => ({
        dateLabel: new Date(key + "T12:00:00Z").toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        jobs: jobsOfDay
          .sort((a, b) => a.win.start.getTime() - b.win.start.getTime())
          .map(({ booking, win }) => ({
            time: win.start.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: orgTz,
            }),
            serviceName:
              booking.service_type_label ?? humanize(booking.service_type),
            clientName: booking.client?.name ?? "A client",
            isSplit: win.isSplit,
          })),
      }));

      const template = employeeWeeklyScheduleEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org.name,
        weekLabel,
        days,
        totalJobs: items.length,
        fieldAppUrl: `${siteUrl}/field/jobs`,
      });

      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
      emailsSent += 1;
    }

    console.log(`[auto] Weekly schedule emails sent for org ${org.id}`);
  }

  return { emailsSent };
}

// 17. Overtime warning (cron Friday 15:00 UTC)
export async function sendOvertimeWarnings(): Promise<{ emailsSent: number }> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeOvertimeWarningEmail } =
    await import("@/lib/email-templates");

  // Week = Monday through Sunday, UTC. Friday = most of the week banked.
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ... 5=Fri, 6=Sat
  const mondayOffset = (day + 6) % 7; // Monday=0, ... Sunday=6
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - mondayOffset);
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekLabel = `Week of ${startOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, name, overtime_threshold_hours")
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      name: string;
      overtime_threshold_hours: number;
    }> | null;
  };

  if (!orgs) return { emailsSent: 0 };
  let emailsSent = 0;

  for (const org of orgs) {
    if (!(await isAutomationEnabled(org.id, "overtime_warning"))) continue;
    const threshold = org.overtime_threshold_hours ?? 40;

    // Sum hours_worked from time_entries per membership for this week.
    // NOTE: the column is employee_id. This said membership_id, which does
    // not exist — PostgREST errored, `data` came back null, every org was
    // skipped as "no entries", and the cron reported success every Friday.
    // The overtime warning had therefore never fired for anyone, including
    // the week containing a 68-hour entry.
    const { data: entries } = (await db
      .from("time_entries")
      .select("employee_id, clock_in_at, clock_out_at")
      .eq("organization_id", org.id)
      .gte("clock_in_at", startOfWeek.toISOString())
      .lt("clock_in_at", endOfWeek.toISOString())
      .not("clock_out_at", "is", null)) as unknown as {
      data: Array<{
        employee_id: string;
        clock_in_at: string;
        clock_out_at: string;
      }> | null;
    };

    if (!entries || entries.length === 0) continue;

    // Accumulate total hours per membership.
    const hoursByMembership = new Map<string, number>();
    for (const e of entries) {
      const ms =
        new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime();
      const hours = ms / (1000 * 60 * 60);
      hoursByMembership.set(
        e.employee_id,
        (hoursByMembership.get(e.employee_id) ?? 0) + hours,
      );
    }

    // Warning band: >= 80% of threshold.
    const warnCutoff = threshold * 0.8;

    // Subcontractors don't accrue overtime, and the email is not merely
    // irrelevant to them — a weekly "you're approaching your overtime limit"
    // from the company to someone that company calls self-employed is written
    // evidence of control, the exact thing a misclassification review looks
    // for. One query per org, not one per person.
    const { data: subs } = (await db
      .from("memberships")
      .select("id")
      .eq("organization_id", org.id)
      .eq("engagement" as never, "subcontractor" as never)) as unknown as {
      data: Array<{ id: string }> | null;
    };
    const subIds = new Set((subs ?? []).map((m) => m.id));

    for (const [membershipId, total] of hoursByMembership) {
      if (total < warnCutoff) continue;
      if (subIds.has(membershipId)) continue;
      const recipient = await getMembershipRecipient(membershipId);
      if (!recipient) continue;

      const template = employeeOvertimeWarningEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org.name,
        hoursWorked: total.toFixed(1),
        thresholdHours: threshold.toFixed(threshold % 1 === 0 ? 0 : 1),
        weekLabel,
        isOver: total >= threshold,
      });
      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
      emailsSent += 1;
    }

    if (emailsSent > 0) {
      console.log(`[auto] Overtime warnings sent for org ${org.id}`);
    }
  }

  return { emailsSent };
}

// ─────────────────────────────────────────────────────────────────
// 17b. Forgotten clock-out: remind, escalate, then cap (cron, every 30 min)
//
// The problem this exists for: an employee clocks in, goes home, and the
// clock keeps running. Observed live — a 68.45h entry against a 6h job, with
// three such entries accounting for 25.7% of one org's entire recorded hours.
//
// Escalation, all measured from the shift's EXPECTED end:
//     0 min  → push the employee: "still working? remember to clock out"
//   +30 min  → repeat, every 30 minutes
//  +120 min  → cap it. Close at expected-end + 2h, flag needs_review,
//              notify the manager (or whoever stands in for one), and SMS
//              the owner.
//
// What it deliberately does NOT do: silently rewrite the hours down to the
// scheduled length. A cleaner who genuinely stayed two extra hours looks
// identical in the data to one who forgot to tap the button, and shaving
// real worked time is both wrong and legally dangerous. We cap the runaway,
// mark it, and let a human say what actually happened.
// ─────────────────────────────────────────────────────────────────

// Grace period and nag interval are per-org now (Settings -> Automations),
// resolved from automation_settings via resolveClockOutThresholds. The old
// hardcoded 120/30 survive as the defaults, so an org that never touches the
// setting behaves exactly as before.

// ─────────────────────────────────────────────────────────────────
// 33b. Job watch — the job that passed in silence
//
// Sibling of the clock-OUT guardrail above, watching the other end of the
// shift. Sollos already notices a job nobody was assigned to, and a shift
// nobody clocked out of. Nothing noticed the job that was assigned, came and
// went, and produced no evidence anyone did it: no clock-in, no status change,
// no human touch. Auto-complete then flips it and drafts an invoice, so the
// first person to discover nothing happened is the client reading the bill.
//
// Two words, each said once (src/lib/job-watch.ts holds the decision):
//   late start   → nudge the crew while showing up is still possible
//   no clock-in  → ask the office, before the money moves
//
// Silent for orgs that don't clock in at all — otherwise every job they book
// would raise a flag, and an alert that is always on is invisible.
// ─────────────────────────────────────────────────────────────────

export async function runJobWatch(): Promise<{
  considered: number;
  nudged: number;
  flagged: number;
  /** Orgs skipped because they have no recent clock-in activity at all. */
  orgsWithoutClockIn: string[];
}> {
  const db = admin();
  const { notify } = await import("@/lib/notify");
  const { classifyJob, orgUsesClockIn } = await import("@/lib/job-watch");
  const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
  const { getOrgTimezone } = await import("@/lib/org-timezone");
  const { formatDateTime } = await import("@/lib/format");

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  // Three days back: far enough to catch a weekend of silence, short enough
  // that switching this on doesn't dredge up months of history in one alert.
  const sinceIso = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = (await db
    .from("bookings")
    .select(
      `id, organization_id, scheduled_at, duration_minutes, status, assigned_to,
       no_show_nudge_sent_at, no_clock_in_flagged_at,
       client:clients ( name )`,
    )
    .in("status", ["confirmed", "in_progress"])
    .gte("scheduled_at", sinceIso)
    .lte("scheduled_at", nowIso)
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      scheduled_at: string;
      duration_minutes: number | null;
      status: string;
      assigned_to: string | null;
      no_show_nudge_sent_at: string | null;
      no_clock_in_flagged_at: string | null;
      client: { name: string | null } | null;
    }> | null;
  };

  const considered = candidates?.length ?? 0;
  let nudged = 0;
  let flagged = 0;
  const orgsWithoutClockIn: string[] = [];
  if (!candidates || candidates.length === 0) {
    return { considered, nudged, flagged, orgsWithoutClockIn };
  }

  // Staffing (assignee OR crew OR claimed offer) and clock-in evidence, both
  // in one pass for every candidate rather than per-booking round trips.
  const ids = candidates.map((b) => b.id);
  const [coverage, { data: entryRows }] = await Promise.all([
    resolveBookingCoverage(ids),
    db
      .from("time_entries")
      .select("booking_id")
      .in("booking_id", ids) as unknown as Promise<{
      data: Array<{ booking_id: string | null }> | null;
    }>,
  ]);
  const clockedBookings = new Set(
    (entryRows ?? []).map((r) => r.booking_id).filter(Boolean) as string[],
  );

  const byOrg = new Map<string, typeof candidates>();
  for (const b of candidates) {
    const list = byOrg.get(b.organization_id) ?? [];
    list.push(b);
    byOrg.set(b.organization_id, list);
  }

  for (const [orgId, jobs] of byOrg) {
    try {
      const [nudgeOn, alertOn] = await Promise.all([
        isAutomationEnabled(orgId, "job_not_started_nudge"),
        isAutomationEnabled(orgId, "no_clock_in_alert"),
      ]);
      if (!nudgeOn && !alertOn) continue;

      // Does this org clock in at all? An org running on paper would flag
      // every job it books.
      const { count: recentEntries } = (await db
        .from("time_entries")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte(
          "clock_in_at",
          new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString(),
        )) as unknown as { count: number | null };
      if (!orgUsesClockIn(recentEntries ?? 0)) {
        orgsWithoutClockIn.push(orgId);
        continue;
      }

      const toFlag: typeof jobs = [];

      for (const b of jobs) {
        const verdict = classifyJob({
          scheduledAtMs: new Date(b.scheduled_at).getTime(),
          durationMinutes: b.duration_minutes,
          status: b.status,
          staffed: Boolean(coverage.get(b.id)?.staffed),
          hasClockIn: clockedBookings.has(b.id),
          nowMs,
          nudgedAtMs: b.no_show_nudge_sent_at
            ? new Date(b.no_show_nudge_sent_at).getTime()
            : null,
          flaggedAtMs: b.no_clock_in_flagged_at
            ? new Date(b.no_clock_in_flagged_at).getTime()
            : null,
        });

        if (verdict.kind === "late_start" && nudgeOn) {
          // Straight to the people who can still fix it. The office is not
          // told yet — someone running fifteen minutes late is not news.
          const crew = coverage.get(b.id)?.employeeIds ?? [];
          const targets = new Set(crew);
          if (b.assigned_to) targets.add(b.assigned_to);
          if (targets.size === 0) continue;

          const orgTz = await getOrgTimezone(orgId);
          const when = formatDateTime(b.scheduled_at, orgTz);
          for (const membershipId of targets) {
            await notify({
              organizationId: orgId,
              audience: "membership",
              membershipId,
              type: "job_not_started",
              title: "You're not clocked in",
              body: `${b.client?.name ?? "A job"} started at ${when} and nobody has clocked in. Open the job to clock in, or tell the office if you can't make it.`,
              href: `/field/jobs/${b.id}`,
            });
          }
          await db
            .from("bookings")
            .update({ no_show_nudge_sent_at: nowIso } as never)
            .eq("id", b.id);
          nudged++;
        } else if (verdict.kind === "no_clock_in" && alertOn) {
          toFlag.push(b);
        }
      }

      // ONE alert for the office listing every silent job, not one per job —
      // the same shape unstaffed_past_booking uses, for the same reason.
      if (toFlag.length > 0) {
        const names = toFlag
          .slice(0, 3)
          .map((b) => b.client?.name ?? "a client")
          .join(", ");
        await notify({
          organizationId: orgId,
          audience: "org-management",
          type: "job_no_clock_in",
          title:
            toFlag.length === 1
              ? "A job finished with no clock-in"
              : `${toFlag.length} jobs finished with no clock-in`,
          body: `${names}${toFlag.length > 3 ? ` and ${toFlag.length - 3} more` : ""} — somebody was assigned and the time has passed, but nobody ever clocked in. Confirm the work happened before it's completed and billed, or cancel it.`,
          // One job → open THAT job. The alert asks for a decision about a
          // specific booking, and landing on a list of hundreds makes the
          // reader do the search the notification already did.
          href:
            toFlag.length === 1
              ? `/app/bookings/${toFlag[0].id}`
              : "/app/bookings",
          // Money is about to move on the strength of no evidence. Email it.
          channels: { email: true },
        });
        await db
          .from("bookings")
          .update({ no_clock_in_flagged_at: nowIso } as never)
          .in(
            "id",
            toFlag.map((b) => b.id),
          );
        flagged += toFlag.length;
      }
    } catch (err) {
      console.error(`[auto] job watch failed for org ${orgId}:`, err);
    }
  }

  if (nudged > 0 || flagged > 0) {
    console.log(
      `[auto] job watch: ${nudged} late-start nudge(s), ${flagged} no-clock-in flag(s) across ${byOrg.size} org(s)`,
    );
  }
  return { considered, nudged, flagged, orgsWithoutClockIn };
}

export async function sendShiftClockOutReminders(): Promise<{
  considered: number;
  reminded: number;
  autoClosed: number;
  /** Open shifts passed over because their org has the toggle off. */
  skippedDisabled: number;
  /** Orgs those shifts belonged to. An open shift sitting in here is
   *  unprotected — nothing will cap it — and the run used to say nothing at
   *  all about that, so "the timer never stopped" only surfaced when someone
   *  complained. */
  orgsDisabled: string[];
}> {
  const db = admin();
  const { notify } = await import("@/lib/notify");
  const { resolveTeamDivision } = await import("@/lib/crew-hours");
  const { resolveResponsiblePhones } = await import("@/lib/org-roles");
  const { sendOrgSms } = await import("@/lib/sms");

  const now = Date.now();
  const nowIso = new Date().toISOString();

  const { data: open } = (await db
    .from("time_entries")
    .select(
      `id, organization_id, employee_id, booking_id, clock_in_at,
       last_reminder_at, reminder_count,
       booking:bookings ( id, scheduled_at, duration_minutes ),
       employee:memberships!time_entries_employee_id_fkey (
         id, display_name, contact_phone, profile:profiles ( full_name, phone )
       )`,
    )
    .is("clock_out_at", null)
    .limit(500)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      employee_id: string;
      booking_id: string | null;
      clock_in_at: string;
      last_reminder_at: string | null;
      reminder_count: number | null;
      booking: {
        id: string;
        scheduled_at: string;
        duration_minutes: number | null;
      } | null;
      employee: {
        id: string;
        display_name: string | null;
        contact_phone: string | null;
        profile: { full_name: string | null; phone: string | null } | null;
      } | null;
    }> | null;
  };

  const considered = open?.length ?? 0;
  let reminded = 0;
  let autoClosed = 0;
  let skippedDisabled = 0;
  const disabledOrgs = new Set<string>();
  if (!open || open.length === 0) {
    return {
      considered,
      reminded,
      autoClosed,
      skippedDisabled,
      orgsDisabled: [],
    };
  }

  const { resolveClockOutThresholds, STANDALONE_SHIFT_MAX_MIN } =
    await import("@/lib/shift-overrun");

  const orgEnabled = new Map<string, boolean>();
  const orgThresholds = new Map<
    string,
    ReturnType<typeof resolveClockOutThresholds>
  >();

  for (const e of open) {
    try {
      let enabled = orgEnabled.get(e.organization_id);
      if (enabled === undefined) {
        enabled = await isAutomationEnabled(
          e.organization_id,
          "shift_clock_out_reminder",
        );
        orgEnabled.set(e.organization_id, enabled);
      }
      if (!enabled) {
        skippedDisabled++;
        disabledOrgs.add(e.organization_id);
        continue;
      }

      let thresholds = orgThresholds.get(e.organization_id);
      if (thresholds === undefined) {
        const { data: orgRow } = (await db
          .from("organizations")
          .select("automation_settings")
          .eq("id", e.organization_id)
          .maybeSingle()) as unknown as {
          data: { automation_settings: Record<string, unknown> | null } | null;
        };
        thresholds = resolveClockOutThresholds(
          orgRow?.automation_settings ?? null,
        );
        orgThresholds.set(e.organization_id, thresholds);
      }
      const { graceMinutes, reminderIntervalMinutes } = thresholds;

      const clockInMs = new Date(e.clock_in_at).getTime();

      // Expected end. For a booked job that's the job's length — divided
      // across the crew when the org divides team hours, so a 2-person 6h
      // job expects 3h from each person, matching what the field app shows.
      // Never earlier than clock-in + that length, so someone who started
      // late still gets their full window before we start nagging.
      let expectedEndMs: number;
      if (e.booking?.duration_minutes) {
        const div = await resolveTeamDivision(
          e.booking.id,
          e.booking.duration_minutes,
        );
        const mins = div.effectiveMinutes;
        expectedEndMs = Math.max(
          new Date(e.booking.scheduled_at).getTime() + mins * 60_000,
          clockInMs + mins * 60_000,
        );
      } else {
        expectedEndMs = clockInMs + STANDALONE_SHIFT_MAX_MIN * 60_000;
      }

      const minutesOver = (now - expectedEndMs) / 60_000;
      if (minutesOver < 0) continue; // still within the expected window

      const firstName =
        (
          e.employee?.display_name ??
          e.employee?.profile?.full_name ??
          ""
        ).split(" ")[0] || "Someone";
      // TWO different numbers, and conflating them was a real bug: the alert
      // said "Nh after their job ended" while passing hoursOpen, so a 2-hour
      // overrun on a 2-hour job reported as 4.0h — always overstated by the
      // length of the job itself.
      const hoursOpen = ((now - clockInMs) / 3_600_000).toFixed(1);
      const hoursOver = ((now - expectedEndMs) / 3_600_000).toFixed(1);
      const employeePhone =
        e.employee?.contact_phone?.trim() ||
        e.employee?.profile?.phone?.trim() ||
        null;

      // ---- Cap it ----
      if (minutesOver >= graceMinutes) {
        const cappedIso = new Date(
          expectedEndMs + graceMinutes * 60_000,
        ).toISOString();

        // Guard on clock_out_at IS NULL so a human closing the shift in the
        // same moment always wins — we never overwrite a real punch.
        const { data: claimed } = (await db
          .from("time_entries")
          .update({
            clock_out_at: cappedIso,
            auto_closed_at: nowIso,
            needs_review: true,
          } as never)
          .eq("id", e.id)
          .is("clock_out_at", null)
          .select("id")) as unknown as { data: Array<{ id: string }> | null };
        if (!claimed || claimed.length === 0) continue;
        autoClosed += 1;

        // The shift is closed, so the "Still on the clock?" nudge on their
        // phone is now false. Retract it — it is sticky by design and would
        // otherwise sit there telling them to do something they can no
        // longer do. See src/lib/clock-nag.ts.
        {
          const { clearClockOutNag } = await import("@/lib/clock-nag");
          await clearClockOutNag({
            membershipId: e.employee_id,
            entryId: e.id,
          });
        }

        // Whoever is responsible — manager, or the owner standing in when the
        // org has no manager.
        await notify({
          audience: "org-management",
          organizationId: e.organization_id,
          type: "shift_auto_closed",
          title: "A shift was auto-closed",
          body: `${firstName} was still clocked in ${hoursOver}h past the end of their job (${hoursOpen}h total). We capped the shift and flagged it for review.`,
          href: "/app/timesheets",
          // Email as well as in-app/push. This has to land even when nobody
          // is looking at the app and the owner has no usable phone — which
          // is exactly how a capped shift went unnoticed for hours.
          channels: { email: true },
        });

        for (const m of await resolveResponsiblePhones(
          e.organization_id,
          "owner",
        )) {
          await sendOrgSms(e.organization_id, {
            to: m.phone!,
            body: `Sollos: ${firstName} never clocked out. ${hoursOver}h past their job end (${hoursOpen}h shift). Capped and flagged for review: sollos3.com/app/timesheets`,
            automationKey: "shift_clock_out_reminder",
          });
        }
        continue;
      }

      // ---- Nag the employee ----
      const lastMs = e.last_reminder_at
        ? new Date(e.last_reminder_at).getTime()
        : 0;
      // Tolerance matters: this cron runs every 30 minutes and the default
      // interval is also 30. A tick landing at +29m38s failed a strict
      // comparison and skipped, so the next nag came an hour later — the
      // reminders went out at half the configured rate. Observed live:
      // reminder_count 2 across a two-hour overrun, at 17:00 and 18:01.
      // Subtracting a minute lets a tick that is fractionally early still
      // count, without ever firing two nags inside one cron period.
      const intervalMs = Math.max(
        60_000,
        reminderIntervalMinutes * 60_000 - 60_000,
      );
      if (now - lastMs < intervalMs) continue;

      await notify({
        audience: "membership",
        organizationId: e.organization_id,
        membershipId: e.employee_id,
        type: "clock_out_reminder",
        title: "Still on the clock?",
        body: `You've been clocked in for ${hoursOpen}h. If you've finished, tap to clock out.`,
        href: "/field/clock",
        // Behave like an ongoing shift indicator rather than a one-off ping:
        // stick in the shade until dismissed, and have each 30-minute update
        // REPLACE the last one (same tag) without buzzing again. Closest the
        // web gets to a Spotify-style persistent notification.
        push: {
          sticky: true,
          quiet: (e.reminder_count ?? 0) > 0,
          tag: `clock-out-${e.id}`,
        },
      });

      // TEXT the cleaner too — this is the whole prevention mechanism, and
      // in-app alone does not reach them: the field app has no notification
      // bell, and web push needs a per-device opt-in most crews never do.
      // A text is the one channel a person in someone's house will notice.
      // Not gated on SMS opt-in: staff are employees, not marketing
      // recipients (same rule as job-assignment texts).
      if (employeePhone) {
        try {
          await sendOrgSms(e.organization_id, {
            to: employeePhone,
            body: `Sollos: you've been clocked in ${hoursOpen}h and your job has ended. Tap to clock out: ${process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com"}/field/clock`,
            automationKey: "shift_clock_out_reminder",
          });
        } catch (smsErr) {
          console.error("[auto] clock-out reminder SMS failed:", e.id, smsErr);
        }
      }
      await db
        .from("time_entries")
        .update({
          last_reminder_at: nowIso,
          reminder_count: (e.reminder_count ?? 0) + 1,
        } as never)
        .eq("id", e.id);
      reminded += 1;
    } catch (err) {
      console.error("[auto] shift reminder failed for entry", e.id, err);
    }
  }

  return {
    considered,
    reminded,
    autoClosed,
    skippedDisabled,
    orgsDisabled: [...disabledOrgs],
  };
}

// 18. PTO status notification (event — called from the approve/decline action)
export async function notifyPtoStatus(ptoRequestId: string): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { employeePtoStatusEmail } = await import("@/lib/email-templates");

    const { data: req } = (await db
      .from("pto_requests")
      .select(
        "id, organization_id, employee_id, start_date, end_date, hours, reason, status",
      )
      .eq("id", ptoRequestId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        employee_id: string;
        start_date: string;
        end_date: string;
        hours: number;
        reason: string | null;
        status: string;
      } | null;
    };

    if (!req) return;
    if (!["approved", "declined", "cancelled"].includes(req.status)) return;

    if (
      !(await isAutomationEnabled(req.organization_id, "pto_status_notify"))
    ) {
      console.log(
        `[auto] PTO status notify paused for org ${req.organization_id}`,
      );
      return;
    }

    const recipient = await getMembershipRecipient(req.employee_id);
    if (!recipient) return;

    const { data: org } = (await db
      .from("organizations")
      .select("name")
      .eq("id", req.organization_id)
      .maybeSingle()) as unknown as { data: { name: string } | null };

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    // PTO start_date/end_date are DATE columns — no time of day, so they are
    // pinned rather than zoned. Zoning a bare date rolls it back a day.
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });

    const template = employeePtoStatusEmail({
      recipientName: recipient.fullName ?? "there",
      orgName: org?.name ?? "your organization",
      status: req.status as "approved" | "declined" | "cancelled",
      startDate: fmt(req.start_date),
      endDate: fmt(req.end_date),
      hours: req.hours,
      reason: req.reason,
      dashboardUrl: `${siteUrl}/field/time-off`,
    });
    await sendEmail({
      to: recipient.email,
      toName: recipient.fullName ?? undefined,
      ...template,
    });
    console.log(
      `[auto] PTO ${req.status} email sent to ${maskEmail(recipient.email)}`,
    );
  } catch (err) {
    console.error("[auto] notifyPtoStatus failed:", err);
  }
}

// 19. Payroll paid receipt (event — called from markPayrollPaidAction)
export async function notifyPayrollPaid(payrollRunId: string): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { employeePayrollPaidEmail } = await import("@/lib/email-templates");
    const { formatCurrencyCents } = await import("@/lib/format");
    const { getOrgCurrency } = await import("@/lib/org-currency");

    const { data: run } = (await db
      .from("payroll_runs")
      .select("id, organization_id, period_start, period_end, paid_at")
      .eq("id", payrollRunId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        period_start: string;
        period_end: string;
        paid_at: string | null;
      } | null;
    };

    if (!run) return;
    if (
      !(await isAutomationEnabled(run.organization_id, "payroll_paid_receipt"))
    ) {
      console.log(
        `[auto] Payroll paid receipt paused for org ${run.organization_id}`,
      );
      return;
    }

    const { data: items } = (await db
      .from("payroll_items")
      .select(
        "employee_id, hours_worked, regular_pay_cents, bonus_cents, pto_hours, pto_pay_cents, total_cents",
      )
      .eq("payroll_run_id", payrollRunId)) as unknown as {
      data: Array<{
        employee_id: string;
        hours_worked: number;
        regular_pay_cents: number;
        bonus_cents: number;
        pto_hours: number;
        pto_pay_cents: number;
        total_cents: number;
      }> | null;
    };

    if (!items || items.length === 0) return;

    const { data: org } = (await db
      .from("organizations")
      .select("name")
      .eq("id", run.organization_id)
      .maybeSingle()) as unknown as { data: { name: string } | null };
    const currency = await getOrgCurrency(run.organization_id);
    const { getOrgTimezone: getPayrollTz } = await import("@/lib/org-timezone");
    const payrollTz = await getPayrollTz(run.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    // paid_at is a timestamptz. Formatted with no zone it rendered in the
    // process timezone — UTC on Vercel — so a run marked paid in the evening
    // dated every employee's receipt to the NEXT day. Wrong for all seven
    // orgs, not only the Edmonton ones, and this is the artifact someone
    // reconciles their pay against.
    const paidDate = new Date(run.paid_at ?? new Date()).toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: payrollTz,
      },
    );
    // period_start / period_end are DATE columns, not timestamps — they carry
    // no time of day, so they are pinned to UTC deliberately. Applying the org
    // zone to a bare date is what rolls it back to the previous day.
    // eslint-disable-next-line no-restricted-syntax -- date column, no tz
    const periodStart = new Date(run.period_start).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const periodEnd = new Date(run.period_end).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    for (const item of items) {
      const recipient = await getMembershipRecipient(item.employee_id);
      if (!recipient) continue;

      const template = employeePayrollPaidEmail({
        recipientName: recipient.fullName ?? "there",
        orgName: org?.name ?? "your organization",
        amountFormatted: formatCurrencyCents(item.total_cents, currency),
        periodStart,
        periodEnd,
        hoursWorked: `${item.hours_worked}`,
        regularPay: formatCurrencyCents(item.regular_pay_cents, currency),
        bonusPay: formatCurrencyCents(item.bonus_cents, currency),
        ptoPay: formatCurrencyCents(item.pto_pay_cents, currency),
        paidDate,
        // /field/pay shows the statement this email describes.
        dashboardUrl: `${siteUrl}/field/pay`,
      });
      await sendEmail({
        to: recipient.email,
        toName: recipient.fullName ?? undefined,
        ...template,
      });
    }
    console.log(`[auto] Payroll paid receipts sent for run ${payrollRunId}`);
  } catch (err) {
    console.error("[auto] notifyPayrollPaid failed:", err);
  }
}

// 20. Training assignment notification (event)
export async function notifyTrainingAssigned(
  assignmentId: string,
): Promise<void> {
  try {
    const db = admin();
    const { sendEmail } = await import("@/lib/email");
    const { employeeTrainingAssignedEmail } =
      await import("@/lib/email-templates");

    const { data: assignment } = (await db
      .from("training_assignments")
      .select("id, organization_id, employee_id, module_id")
      .eq("id", assignmentId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        employee_id: string;
        module_id: string;
      } | null;
    };

    if (!assignment) return;
    if (
      !(await isAutomationEnabled(
        assignment.organization_id,
        "training_assigned_notify",
      ))
    ) {
      return;
    }

    const [{ data: module }, { data: org }] = await Promise.all([
      db
        .from("training_modules")
        .select("title, description")
        .eq("id", assignment.module_id)
        .maybeSingle() as unknown as Promise<{
        data: { title: string; description: string | null } | null;
      }>,
      db
        .from("organizations")
        .select("name")
        .eq("id", assignment.organization_id)
        .maybeSingle() as unknown as Promise<{
        data: { name: string } | null;
      }>,
    ]);

    if (!module) return;
    const recipient = await getMembershipRecipient(assignment.employee_id);
    if (!recipient) return;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
    const template = employeeTrainingAssignedEmail({
      recipientName: recipient.fullName ?? "there",
      orgName: org?.name ?? "your organization",
      moduleTitle: module.title,
      moduleDescription: module.description,
      trainingUrl: `${siteUrl}/field/training/${assignment.module_id}`,
    });
    await sendEmail({
      to: recipient.email,
      toName: recipient.fullName ?? undefined,
      ...template,
    });
    console.log(
      `[auto] Training assigned email sent to ${maskEmail(recipient.email)}`,
    );
  } catch (err) {
    console.error("[auto] notifyTrainingAssigned failed:", err);
  }
}

// 21. Certification expiry reminders (cron daily 14:00 UTC)
export async function sendCertificationExpiryReminders(): Promise<{
  sent: number;
}> {
  const db = admin();
  const { sendEmail } = await import("@/lib/email");
  const { employeeCertificationExpiryEmail } =
    await import("@/lib/email-templates");

  const now = Date.now();
  const in30d = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  const in7d = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all assignments expiring in the next 30 days that need an alert.
  const { data: rows } = (await db
    .from("training_assignments")
    .select(
      `
      id, organization_id, employee_id, module_id, certification_expires_at,
      expiry_reminder_30d_sent_at, expiry_reminder_7d_sent_at
    `,
    )
    .not("certification_expires_at", "is", null)
    .gte("certification_expires_at", new Date(now).toISOString())
    .lte("certification_expires_at", in30d)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      employee_id: string;
      module_id: string;
      certification_expires_at: string;
      expiry_reminder_30d_sent_at: string | null;
      expiry_reminder_7d_sent_at: string | null;
    }> | null;
  };

  if (!rows || rows.length === 0) return { sent: 0 };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  let sent = 0;

  for (const a of rows) {
    if (
      !(await isAutomationEnabled(
        a.organization_id,
        "certification_expiry_reminder",
      ))
    ) {
      continue;
    }

    const expiresAt = a.certification_expires_at;
    const daysUntil = Math.max(
      1,
      Math.ceil((new Date(expiresAt).getTime() - now) / (24 * 60 * 60 * 1000)),
    );

    // Which reminder bucket? Priority: 7-day > 30-day.
    const needs7d = expiresAt <= in7d && !a.expiry_reminder_7d_sent_at;
    const needs30d = !needs7d && !a.expiry_reminder_30d_sent_at;

    if (!needs7d && !needs30d) continue;

    const [{ data: module }, { data: org }] = await Promise.all([
      db
        .from("training_modules")
        .select("title")
        .eq("id", a.module_id)
        .maybeSingle() as unknown as Promise<{
        data: { title: string } | null;
      }>,
      db
        .from("organizations")
        .select("name")
        .eq("id", a.organization_id)
        .maybeSingle() as unknown as Promise<{
        data: { name: string } | null;
      }>,
    ]);

    if (!module) continue;
    const recipient = await getMembershipRecipient(a.employee_id);
    if (!recipient) continue;

    const template = employeeCertificationExpiryEmail({
      recipientName: recipient.fullName ?? "there",
      orgName: org?.name ?? "your organization",
      moduleTitle: module.title,
      // expires_at here is a DATE column — pinned, not zoned.
      expiresOn: new Date(expiresAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
      daysUntilExpiry: daysUntil,
      trainingUrl: `${siteUrl}/field/training/${a.module_id}`,
    });
    await sendEmail({
      to: recipient.email,
      toName: recipient.fullName ?? undefined,
      ...template,
    });

    // Stamp the correct bucket.
    const update = needs7d
      ? { expiry_reminder_7d_sent_at: new Date().toISOString() }
      : { expiry_reminder_30d_sent_at: new Date().toISOString() };

    await db.from("training_assignments").update(update).eq("id", a.id);

    sent += 1;
  }

  if (sent > 0)
    console.log(`[auto] Certification expiry reminders sent: ${sent}`);
  return { sent };
}

// ─────────────────────────────────────────────────────────────────
// SYSTEM HYGIENE AUTOMATIONS
//
// No human notification — these just keep state tidy. Per-org toggles
// default to on, and per-org tuning (day thresholds) lives on columns
// on the organizations table. NULL threshold disables the cron for
// that org.
// ─────────────────────────────────────────────────────────────────

// 22. Auto-expire stale estimates (daily)
export async function autoExpireStaleEstimates(): Promise<{ expired: number }> {
  const db = admin();
  let expired = 0;

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, stale_estimate_expire_days")
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      stale_estimate_expire_days: number | null;
    }> | null;
  };

  for (const org of orgs ?? []) {
    if (!(await isAutomationEnabled(org.id, "auto_expire_stale_estimates")))
      continue;
    // NULL = explicitly blanked in Settings → Thresholds = disabled
    // (audit T5 — defaults are backfilled by migration 20260726010000).
    if (org.stale_estimate_expire_days == null) continue;
    const days = org.stale_estimate_expire_days;
    if (days < 1) continue;

    const cutoff = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = (await db
      .from("estimates")
      .update({ status: "expired" })
      .eq("organization_id", org.id)
      .eq("status", "sent")
      .lt("sent_at", cutoff)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error(
        `[auto] expire estimates failed for org ${org.id}:`,
        error.message,
      );
      continue;
    }
    if (data && data.length > 0) {
      expired += data.length;
      console.log(
        `[auto] Expired ${data.length} stale estimate(s) for org ${org.id}`,
      );
    }
  }
  return { expired };
}

// 23. Auto-void overdue invoices with no payment (daily)
export async function autoVoidOldInvoices(): Promise<{ voided: number }> {
  const db = admin();
  const { zonedYmd } = await import("@/lib/wall-clock");
  let voided = 0;

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, invoice_void_days, timezone")
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      invoice_void_days: number | null;
      timezone: string | null;
    }> | null;
  };

  for (const org of orgs ?? []) {
    if (!(await isAutomationEnabled(org.id, "auto_void_overdue_invoices")))
      continue;
    if (org.invoice_void_days == null) continue; // blank = disabled (T5)
    const days = org.invoice_void_days;
    if (days < 30) continue;

    // Cutoff in the ORG's calendar. due_date is an org-local date, and the
    // cron fires at 21:30 Edmonton — already tomorrow in UTC, so a UTC slice
    // voided invoices one org-local day early.
    const cutoff = zonedYmd(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      org.timezone ?? "America/Edmonton",
    );

    // voided_at is the system-wide source of truth for "void" (the payment
    // trigger, webhooks, and every dedup query key on it). Setting only the
    // status meant any later ledger event silently resurrected the "void"
    // back to sent/overdue, and payments could still be recorded against it
    // (audit P3).
    const { data, error } = (await db
      .from("invoices")
      .update({ status: "void", voided_at: new Date().toISOString() })
      .eq("organization_id", org.id)
      .eq("status", "overdue")
      .is("paid_at", null)
      .is("voided_at", null)
      .lt("due_date", cutoff)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error(
        `[auto] void invoices failed for org ${org.id}:`,
        error.message,
      );
      continue;
    }
    if (data && data.length > 0) {
      voided += data.length;
      console.log(
        `[auto] Voided ${data.length} old overdue invoice(s) for org ${org.id}`,
      );
    }
  }
  return { voided };
}

// 24. Auto-complete past bookings (daily)
export async function autoCompletePastBookings(): Promise<{
  completed: number;
}> {
  const db = admin();
  let completed = 0;

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, booking_auto_complete_hours")
    .is("deleted_at", null)) as unknown as {
    data: Array<{
      id: string;
      booking_auto_complete_hours: number | null;
    }> | null;
  };

  for (const org of orgs ?? []) {
    // Two different questions, and they used to share one gate:
    //
    //   "should I flip statuses and draft invoices?"  — the toggle below
    //   "should I tell someone this job looks wrong?" — never optional
    //
    // The watchdog notifications (stale pending, unstaffed past) sat INSIDE
    // the auto-complete gate, so an owner who turned auto-complete off — or
    // just blanked the threshold — silently lost the warnings too, which is
    // precisely backwards: an org that doesn't auto-complete has MORE past
    // jobs drifting, not fewer. The alerts now run regardless; only the
    // status flip honours the toggle.
    const completionEnabled =
      (await isAutomationEnabled(org.id, "auto_complete_past_bookings")) &&
      org.booking_auto_complete_hours != null &&
      org.booking_auto_complete_hours >= 1;

    // Threshold for "past enough to be worth mentioning". When completion is
    // off there is no configured threshold, so fall back to a day — long
    // enough that this evening's jobs aren't nagged about tonight.
    const hours = completionEnabled
      ? (org.booking_auto_complete_hours as number)
      : 24;

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Pending past its date is a human problem too, and a different one: the
    // office penciled a job in and never came back to it. Deliberately NOT in
    // the auto-complete set below — a duplicated job carries the source's
    // assignee and date, so a duplicate of a past job is pending + staffed +
    // past-due, exactly the shape that would auto-complete and draft an
    // invoice for something nobody ever confirmed.
    const { data: stalePending } = (await db
      .from("bookings")
      .select("id, scheduled_at, client:clients ( name )")
      .eq("organization_id", org.id)
      .eq("status", "pending")
      .lt("scheduled_at", cutoff)
      .limit(50)) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        client: { name: string | null } | null;
      }> | null;
    };
    if (stalePending && stalePending.length > 0) {
      const names = stalePending
        .slice(0, 3)
        .map((b) => b.client?.name ?? "a client")
        .join(", ");
      await notify({
        audience: "org-management",
        organizationId: org.id,
        type: "general",
        title:
          stalePending.length === 1
            ? "A pending job's date has passed"
            : `${stalePending.length} pending jobs have passed their date`,
        body: `${names}${stalePending.length > 3 ? ` and ${stalePending.length - 3} more` : ""} — still marked Pending, so nobody confirmed them and the time has gone by. Confirm them if they happened, or cancel them.`,
        href:
          stalePending.length === 1
            ? `/app/bookings/${stalePending[0].id}`
            : "/app/bookings?status=pending",
        channels: { email: true },
      });
    }

    // Find candidates FIRST — we no longer blanket-complete, because a
    // booking nobody was assigned to is not evidence that work happened.
    // Auto-completing one drafts an invoice (and, with auto-send on, emails
    // a client a bill) for a job the system has no record of anyone doing.
    const { data: candidates, error: findErr } = (await db
      .from("bookings")
      .select("id, scheduled_at, client:clients ( name )")
      .eq("organization_id", org.id)
      // Confirmed OR in progress; completed/cancelled are terminal, and
      // pending is handled above — it must never auto-complete.
      .in("status", ["confirmed", "in_progress"])
      .lt("scheduled_at", cutoff)
      .limit(200)) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        client: { name: string | null } | null;
      }> | null;
      error: { message: string } | null;
    };
    if (findErr) {
      console.error(
        `[auto] complete bookings failed for org ${org.id}:`,
        findErr.message,
      );
      continue;
    }
    if (!candidates || candidates.length === 0) continue;

    // Staffed = an assigned employee, a crew member, OR a claimed bench
    // offer. That last one is why this uses the shared helper: a freelancer
    // claim can't write bookings.assigned_to, so checking that column alone
    // reads a covered job as empty.
    const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
    const coverage = await resolveBookingCoverage(candidates.map((b) => b.id));

    const staffedIds: string[] = [];
    const unstaffed: typeof candidates = [];
    for (const b of candidates) {
      if (coverage.get(b.id)?.staffed) staffedIds.push(b.id);
      else unstaffed.push(b);
    }

    // Unstaffed past jobs are a human problem, not a cron problem. Leave the
    // status alone and tell whoever can sort it out.
    if (unstaffed.length > 0) {
      const names = unstaffed
        .slice(0, 3)
        .map((b) => b.client?.name ?? "a client")
        .join(", ");
      await notify({
        audience: "org-management",
        organizationId: org.id,
        type: "unstaffed_past_booking",
        title:
          unstaffed.length === 1
            ? "A past job was never staffed"
            : `${unstaffed.length} past jobs were never staffed`,
        body: `${unstaffed.length > 3 ? `${names} and ${unstaffed.length - 3} more` : names} — nobody was assigned and the time has passed. These were NOT completed or invoiced. Check what happened, then close them out by hand.`,
        // Straight to the job when there's only one to look at.
        href:
          unstaffed.length === 1
            ? `/app/bookings/${unstaffed[0].id}`
            : "/app/bookings",
        // Work that never happened and was never billed. Email it.
        channels: { email: true },
      });
      console.log(
        `[auto] ${unstaffed.length} unstaffed past booking(s) left alone for org ${org.id}`,
      );
    }

    // Everything above is watchdog reporting and runs for every org. Only the
    // status flip + invoicing below is the auto-complete FEATURE.
    if (!completionEnabled) continue;
    if (staffedIds.length === 0) continue;

    const { data, error } = (await db
      .from("bookings")
      .update({ status: "completed" })
      .eq("organization_id", org.id)
      .in("id", staffedIds)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error(
        `[auto] complete bookings failed for org ${org.id}:`,
        error.message,
      );
      continue;
    }
    if (data && data.length > 0) {
      completed += data.length;
      console.log(
        `[auto] Auto-completed ${data.length} past booking(s) for org ${org.id}`,
      );

      // Parity with the manual "mark complete" path: draft the per-job invoice
      // for each booking we just auto-completed. Without this, jobs the cron
      // completes were silently never billed. Non-forced, so it still respects
      // the org's auto_invoice_on_job_complete toggle AND the client's billing
      // cadence (monthly/biweekly clients are billed by the billing-cycle cron
      // instead, so autoInvoiceOnJobComplete no-ops for them).
      for (const b of data) {
        try {
          await autoInvoiceOnJobComplete(b.id);
        } catch (err) {
          console.error(
            `[auto] auto-invoice after auto-complete failed for booking ${b.id}:`,
            err,
          );
        }
      }
    }
  }
  return { completed };
}

// 25. Auto-archive old records (daily)
export async function autoArchiveOldRecords(): Promise<{
  bookings: number;
  invoices: number;
  estimates: number;
}> {
  const db = admin();
  const totals = { bookings: 0, invoices: 0, estimates: 0 };

  const { data: orgs } = (await db
    .from("organizations")
    .select("id, archive_after_days")
    .is("deleted_at", null)) as unknown as {
    data: Array<{ id: string; archive_after_days: number | null }> | null;
  };

  for (const org of orgs ?? []) {
    if (!(await isAutomationEnabled(org.id, "auto_archive_old_records")))
      continue;
    if (org.archive_after_days == null) continue; // blank = disabled (T5)
    const days = org.archive_after_days;
    if (days < 180) continue;

    const cutoff = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const now = new Date().toISOString();

    // Archive bookings where scheduled_at is older than cutoff AND status is
    // a terminal one (completed/cancelled). Active bookings are never
    // archived even if dated in the past (shouldn't happen if the complete
    // cron ran, but safety first).
    const [{ data: b }, { data: i }, { data: e }] = await Promise.all([
      db
        .from("bookings")
        .update({ archived_at: now })
        .eq("organization_id", org.id)
        .is("archived_at", null)
        .in("status", ["completed", "cancelled"])
        .lt("scheduled_at", cutoff)
        .select("id") as unknown as Promise<{
        data: Array<{ id: string }> | null;
      }>,
      db
        .from("invoices")
        .update({ archived_at: now })
        .eq("organization_id", org.id)
        .is("archived_at", null)
        .in("status", ["paid", "void"])
        .lt("created_at", cutoff)
        .select("id") as unknown as Promise<{
        data: Array<{ id: string }> | null;
      }>,
      db
        .from("estimates")
        .update({ archived_at: now })
        .eq("organization_id", org.id)
        .is("archived_at", null)
        .in("status", ["approved", "declined", "expired"])
        .lt("created_at", cutoff)
        .select("id") as unknown as Promise<{
        data: Array<{ id: string }> | null;
      }>,
    ]);

    totals.bookings += b?.length ?? 0;
    totals.invoices += i?.length ?? 0;
    totals.estimates += e?.length ?? 0;

    if ((b?.length ?? 0) + (i?.length ?? 0) + (e?.length ?? 0) > 0) {
      console.log(
        `[auto] Archived for org ${org.id}: bookings=${b?.length ?? 0} invoices=${i?.length ?? 0} estimates=${e?.length ?? 0}`,
      );
    }
  }
  return totals;
}

// 26. Auto-generate recurring invoices (daily)
export async function autoGenerateRecurringInvoices(): Promise<{
  generated: number;
}> {
  const db = admin();
  let generated = 0;

  const now = new Date();
  const nowIso = now.toISOString();

  const { data: due } = (await db
    .from("invoice_series")
    .select(
      `
      id, organization_id, client_id, name, cadence,
      amount_cents, line_items, notes, next_run_at, due_days
    `,
    )
    .eq("active", true)
    .lte("next_run_at", nowIso)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      client_id: string;
      name: string;
      cadence: "weekly" | "biweekly" | "monthly" | "quarterly";
      amount_cents: number;
      line_items: unknown;
      notes: string | null;
      next_run_at: string;
      due_days: number;
    }> | null;
  };

  if (!due || due.length === 0) return { generated };

  for (const series of due) {
    if (
      !(await isAutomationEnabled(
        series.organization_id,
        "auto_recurring_invoices",
      ))
    ) {
      continue;
    }

    const issuedAt = new Date();
    const dueDate = new Date(
      issuedAt.getTime() + series.due_days * 24 * 60 * 60 * 1000,
    );

    // Compute the next run date based on cadence. Month adds are CLAMPED to
    // the target month's last day — naive setUTCMonth on Jan 31 lands on
    // "Feb 31" = Mar 3, permanently drifting the series off its anchor day
    // and skipping a whole billing month (audit P6).
    const addMonthsClamped = (from: Date, months: number): Date => {
      const y = from.getUTCFullYear();
      const m = from.getUTCMonth() + months;
      const lastDayOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(
        Date.UTC(
          y,
          m,
          Math.min(from.getUTCDate(), lastDayOfTarget),
          from.getUTCHours(),
          from.getUTCMinutes(),
          from.getUTCSeconds(),
        ),
      );
    };
    const current = new Date(series.next_run_at);
    let next = new Date(current);
    switch (series.cadence) {
      case "weekly":
        next.setUTCDate(current.getUTCDate() + 7);
        break;
      case "biweekly":
        next.setUTCDate(current.getUTCDate() + 14);
        break;
      case "monthly":
        next = addMonthsClamped(current, 1);
        break;
      case "quarterly":
        next = addMonthsClamped(current, 3);
        break;
    }

    // CLAIM the run BEFORE creating the invoice. Advancing next_run_at is a
    // conditional update guarded on its current value, so two concurrent runs
    // (or a retry of a run that crashed after inserting the invoice) can't both
    // generate an invoice for the same period — exactly one wins the claim and
    // the loser gets 0 rows back. The previous order (insert, THEN advance)
    // meant a crash in between re-generated the invoice on the next tick.
    const { data: claimed } = (await db
      .from("invoice_series")
      .update({ next_run_at: next.toISOString() })
      .eq("id", series.id)
      .eq("next_run_at", series.next_run_at)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };

    if (!claimed || claimed.length === 0) {
      // Another concurrent run already claimed this period.
      continue;
    }

    // ── Double-billing guard ─────────────────────────────────────────
    // booking_series and invoice_series are separate recurrence engines.
    // A client on a billing CYCLE already gets their bookings swept into
    // consolidated invoices — a standing invoice on top is double-billing
    // by construction. HOLD the standing one (the cycle knows the actual
    // work; this row only knows a number) and tell management to pick an
    // engine. The claim above already advanced the clock, so this warns
    // once per period, never daily.
    const { data: seriesClient } = (await db
      .from("clients")
      .select("name, billing_cadence")
      .eq("id", series.client_id)
      .maybeSingle()) as unknown as {
      data: { name: string | null; billing_cadence: string | null } | null;
    };
    if (
      seriesClient?.billing_cadence &&
      seriesClient.billing_cadence !== "on_demand"
    ) {
      await notify({
        organizationId: series.organization_id,
        audience: "org-management",
        title: "Standing invoice held — client is on a billing cycle",
        body: `${seriesClient.name ?? "A client"} has BOTH a ${seriesClient.billing_cadence} billing cycle and the standing invoice "${series.name}". The cycle already bills their jobs, so the standing invoice was NOT sent this period — keep one or the other.`,
        href: "/app/settings/recurring-invoices",
      }).catch((err) =>
        console.error("[auto] recurring-invoice hold notify failed:", err),
      );
      continue;
    }

    // Let the DB trigger assign the invoice number — it uses the
    // INV-YYYY-XXXX format consistently across all invoice creation
    // paths. The previous code computed a count-based "INV-0001"
    // (no year, racy) which then collided with the trigger's format
    // for every other invoice in the org, producing inconsistent UX
    // in exports + the bookings list.
    // Core insert uses ONLY long-standing invoice columns. The previous
    // version passed `line_items` and `notes` directly — neither column
    // existed on `invoices`, so PostgREST rejected EVERY insert (PGRST204)
    // and this automation never generated a single invoice (audit C1).
    // Line items live in invoice_line_items; notes are applied as a
    // separate best-effort update below.
    const { data: inserted, error } = (await db
      .from("invoices")
      .insert({
        organization_id: series.organization_id,
        client_id: series.client_id,
        // number: omitted → trigger fills it
        status: "draft",
        amount_cents: series.amount_cents,
        due_date: dueDate.toISOString().slice(0, 10),
      })
      .select("id")
      .single()) as unknown as {
      data: { id: string } | null;
      error: { message: string } | null;
    };

    if (error || !inserted) {
      console.error(
        `[auto] recurring invoice failed for series ${series.id}:`,
        error?.message,
      );
      // Roll the claim back so this period retries next tick rather than being
      // silently skipped. Guarded on our advanced value so we don't clobber a
      // newer claim.
      await db
        .from("invoice_series")
        .update({ next_run_at: series.next_run_at })
        .eq("id", series.id)
        .eq("next_run_at", next.toISOString());
      continue;
    }

    // Notes — separate best-effort step so a not-yet-migrated `notes`
    // column can't take down the whole path (same pattern as the tax step
    // in autoInvoiceOnJobComplete).
    if (series.notes) {
      try {
        await db
          .from("invoices")
          .update({ notes: series.notes } as never)
          .eq("id", inserted.id);
      } catch (notesErr) {
        console.error(
          `[auto] recurring invoice ${inserted.id}: notes update failed (invoice still created):`,
          notesErr,
        );
      }
    }

    // Line items — write the series' configured items into the real
    // invoice_line_items table. Tolerant of loose shapes (the series form
    // accepts raw JSON): anything unusable degrades to a single line for
    // the full amount so the invoice is never blank.
    try {
      const rawItems = Array.isArray(series.line_items)
        ? (series.line_items as Array<Record<string, unknown>>)
        : [];
      const items = rawItems
        .filter((it) => it && typeof it === "object")
        .map((it, i) => ({
          organization_id: series.organization_id,
          invoice_id: inserted.id,
          label:
            typeof it.label === "string" && it.label.trim()
              ? it.label.trim().slice(0, 300)
              : series.name,
          quantity:
            typeof it.quantity === "number" && it.quantity > 0
              ? it.quantity
              : 1,
          unit_price_cents:
            typeof it.unit_price_cents === "number" && it.unit_price_cents >= 0
              ? Math.round(it.unit_price_cents)
              : 0,
          sort_order: i,
        }));

      const rows =
        items.length > 0
          ? items
          : [
              {
                organization_id: series.organization_id,
                invoice_id: inserted.id,
                label: series.name,
                quantity: 1,
                unit_price_cents: series.amount_cents,
                sort_order: 0,
              },
            ];

      const { error: liErr } = await db
        .from("invoice_line_items")
        .insert(rows as never);
      if (liErr) {
        console.error(
          `[auto] recurring invoice ${inserted.id}: line item insert failed (invoice still created):`,
          liErr.message,
        );
      }
    } catch (liErr) {
      console.error(
        `[auto] recurring invoice ${inserted.id}: line item step threw:`,
        liErr,
      );
    }

    // Link the generated invoice back to the series (claim already advanced
    // next_run_at above).
    await db
      .from("invoice_series")
      .update({
        last_generated_at: nowIso,
        last_invoice_id: inserted.id,
      })
      .eq("id", series.id);

    // The other half of the double-billing guard: an on-demand client's
    // standing invoice went out while completed jobs sit unbilled. Whether
    // the standing amount COVERS those jobs is a judgment call the system
    // must not make (auto-stamping them "billed" would silently under-bill
    // a client whose standing fee is for something else) — so a human gets
    // the question, with the numbers.
    try {
      const { count: unbilledCount } = (await db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("client_id", series.client_id)
        .eq("organization_id", series.organization_id)
        .eq("status", "completed")
        .is("billing_invoice_id", null)
        .lt("scheduled_at", nowIso)) as unknown as { count: number | null };
      if ((unbilledCount ?? 0) > 0) {
        await notify({
          organizationId: series.organization_id,
          audience: "org-management",
          title: "Standing invoice sent — unbilled jobs alongside it",
          body: `The standing invoice "${series.name}" went out while ${unbilledCount} completed job${unbilledCount === 1 ? "" : "s"} for the same client ${unbilledCount === 1 ? "sits" : "sit"} unbilled. If the standing amount covers them, link them on an invoice; if not, bill them separately — don't let them ride unnoticed.`,
          href: `/app/invoices/new?client_id=${series.client_id}`,
        });
      }
    } catch (err) {
      console.error("[auto] recurring-invoice unbilled check failed:", err);
    }

    // Schedule auto-send if the org opted in — recurring drafts previously
    // sat unsent forever while per-job and consolidated invoices auto-sent
    // (audit M7).
    try {
      const { scheduleAutoSendIfEnabled } = await import("@/lib/invoice-send");
      await scheduleAutoSendIfEnabled(inserted.id, series.organization_id, {
        consolidated: true,
      });
    } catch (scheduleErr) {
      console.error(
        `[auto] recurring invoice ${inserted.id}: auto-send schedule failed (still drafted):`,
        scheduleErr,
      );
    }

    generated += 1;
    console.log(
      `[auto] Generated recurring invoice ${inserted.id} for series ${series.id} (org ${series.organization_id})`,
    );
  }

  return { generated };
}

// ─────────────────────────────────────────────────────────────────
// Task reminder push notification
//
// Called by the remind_at cron — fires a push to the assignee (or all
// managers if unassigned) and stamps reminded_at so it never re-fires.
// ─────────────────────────────────────────────────────────────────

export async function sendTaskReminder(taskId: string): Promise<void> {
  try {
    const db = admin();
    const { data: task } = (await db
      .from("tasks")
      .select(
        "id, organization_id, title, notes, assigned_to, reminded_at, completed_at",
      )
      .eq("id", taskId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        title: string;
        notes: string | null;
        assigned_to: string | null;
        reminded_at: string | null;
        completed_at: string | null;
      } | null;
    };

    if (!task) return;
    // Skip if already reminded or already completed
    if (task.reminded_at || task.completed_at) return;

    const body = task.notes ? task.notes.slice(0, 120) : "Tap to view details.";

    if (task.assigned_to) {
      await sendPushToMembership(task.assigned_to, {
        title: `📋 Task reminder: ${task.title}`,
        body,
        href: "/app/tasks",
      });
    } else {
      // Unassigned — notify all active managers+ in the org
      const { data: managers } = (await db
        .from("memberships")
        .select("id")
        .eq("organization_id", task.organization_id)
        .in("role", ["owner", "admin", "manager"])
        .eq("status", "active")) as unknown as {
        data: Array<{ id: string }> | null;
      };

      await Promise.allSettled(
        (managers ?? []).map((m) =>
          sendPushToMembership(m.id, {
            title: `📋 Task reminder: ${task.title}`,
            body,
            href: "/app/tasks",
          }),
        ),
      );
    }

    // Stamp reminded_at so the cron doesn't re-fire
    await db
      .from("tasks")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", taskId);
  } catch (err) {
    console.error("[auto] sendTaskReminder failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function humanize(s: string | null | undefined): string {
  if (!s) return "Cleaning";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Infer service_type enum from free-text estimate description. */
function inferServiceType(
  description: string | null | undefined,
): "standard" | "deep" | "move_out" | "recurring" {
  if (!description) return "standard";
  const d = description.toLowerCase();
  if (
    d.includes("move out") ||
    d.includes("move-out") ||
    d.includes("moveout") ||
    d.includes("end of tenancy")
  )
    return "move_out";
  if (
    d.includes("deep clean") ||
    d.includes("deep-clean") ||
    d.includes("spring clean")
  )
    return "deep";
  if (
    d.includes("recurring") ||
    d.includes("weekly") ||
    d.includes("bi-weekly") ||
    d.includes("monthly")
  )
    return "recurring";
  return "standard";
}
