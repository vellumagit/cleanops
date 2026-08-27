import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * A payee is one of two different things, and the difference is structural,
 * not cosmetic:
 *
 *   contact     a bench freelancer (freelancer_contacts). Earns per CLAIMED
 *               shift offer — a fixed pay_cents agreed up front.
 *   membership  a roster subcontractor. Earns from CLOCKED HOURS, priced with
 *               exactly the same precedence payroll uses, because the same
 *               shift must not be worth two different amounts depending on
 *               which screen you open.
 *
 * Encoded as a tagged key so a Map can hold both without one masking the
 * other. Grouping on a bare id would collide the instant a contact and a
 * membership shared a uuid, and would silently produce a null-keyed row the
 * first time a membership payout was written.
 */
export type PayeeRef =
  | { kind: "contact"; id: string }
  | { kind: "membership"; id: string };

export function payeeKey(p: PayeeRef): string {
  return `${p.kind}:${p.id}`;
}

/**
 * The payee as a URL segment.
 *
 * Bare uuid means a bench contact, so every /app/payroll/contractors/<uuid>
 * link that exists today — in bookmarks, in emails, in the audit log — keeps
 * resolving to the same person. Roster subcontractors get an "m-" prefix.
 */
export function encodePayeeParam(p: PayeeRef): string {
  return p.kind === "membership" ? `m-${p.id}` : p.id;
}

export function parsePayeeParam(raw: string): PayeeRef {
  return raw.startsWith("m-")
    ? { kind: "membership", id: raw.slice(2) }
    : { kind: "contact", id: raw };
}

export function parsePayeeKey(key: string): PayeeRef {
  const [kind, ...rest] = key.split(":");
  return { kind: kind === "membership" ? "membership" : "contact", id: rest.join(":") };
}

/**
 * Subcontractor payables — what the business owes each subcontractor.
 *
 * "Earned" is derived, not stored: a subcontractor earns an offer's pay_cents
 * for each shift offer they CLAIMED whose booking is now COMPLETED. "Paid" is
 * the sum of recorded subcontractor_payouts. Outstanding = earned − paid.
 *
 * All reads use the service-role client; callers must gate access
 * (owner/admin/manager) before calling.
 */

export type PayableSummary = {
  payee: PayeeRef;
  /** Bench contacts only — kept so existing links keep working. */
  contactId: string | null;
  name: string;
  /** Roster subcontractors are people you also schedule; the bench are not. */
  isRoster: boolean;
  earnedCents: number;
  paidCents: number;
  outstandingCents: number;
  jobCount: number;
  /** Capped shifts (needs_review) EXCLUDED from earnedCents until an owner
   *  confirms them on Timesheets — payroll refuses to pay unbelieved hours,
   *  and this screen must not be the loophole. */
  unreviewedCount: number;
};

export type LedgerJob = {
  offerId: string;
  bookingId: string | null;
  scheduledAt: string | null;
  serviceType: string | null;
  payCents: number;
};

export type LedgerPayout = {
  id: string;
  amountCents: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
};

export type LedgerBill = {
  id: string;
  label: string;
  amountCents: number | null;
  billDate: string | null;
  fileName: string;
  filePath: string;
  mimeType: string | null;
  createdAt: string;
};

export type SubcontractorLedger = {
  contact: { id: string; name: string; phone: string | null; email: string | null } | null;
  jobs: LedgerJob[];
  payouts: LedgerPayout[];
  bills: LedgerBill[];
  earnedCents: number;
  paidCents: number;
  outstandingCents: number;
  /** Capped shifts (needs_review) excluded from earnedCents until confirmed
   *  on Timesheets. Roster subcontractors only — claims can't be capped. */
  unreviewedCount: number;
  unreviewedMinutes: number;
  /** Pay-period statements this payee appears on, newest first. Unpaid ones
   *  are already included in earnedCents; paid ones are history. */
  statements: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    totalCents: number;
    minutes: number;
    status: "finalized" | "paid";
    paidAt: string | null;
  }>;
};

/**
 * Org-wide list of subcontractors with a balance, plus the total still owed.
 * Includes anyone who has earned or been paid; sorted by outstanding desc.
 */
export async function getSubcontractorPayables(
  organizationId: string,
): Promise<{ rows: PayableSummary[]; totalOutstandingCents: number }> {
  const admin = createSupabaseAdminClient();

  const earned = new Map<string, number>();
  const jobCount = new Map<string, number>();
  // Capped shifts awaiting an owner's confirmation — counted, never priced.
  const unreviewed = new Map<string, number>();

  // On-call cleaners earn the agreed pay_cents per claimed shift. The
  // null-contact guard below is load-bearing: a roster subcontractor's claim
  // (membership_id set, contact_id null) is assignment, never flat pay.
  const { data: claims } = (await admin
    .from("job_offer_claims" as never)
    .select(
      "contact_id, offer:job_offers ( pay_cents, booking:bookings ( status ) )",
    )
    .eq("organization_id" as never, organizationId as never)) as unknown as {
    data: Array<{
      contact_id: string;
      offer: {
        pay_cents: number | null;
        booking: { status: string } | null;
      } | null;
    }> | null;
  };
  for (const c of claims ?? []) {
    if (!c.contact_id) continue;
    if (c.offer?.booking?.status === "completed") {
      const k = payeeKey({ kind: "contact", id: c.contact_id });
      earned.set(k, (earned.get(k) ?? 0) + (c.offer.pay_cents ?? 0));
      jobCount.set(k, (jobCount.get(k) ?? 0) + 1);
    }
  }

  /*
   * Roster subcontractors earn from CLOCKED HOURS, priced with payroll's exact
   * precedence — duplicated deliberately rather than approximated:
   *
   *   1. booking.hourly_rate_cents            per-booking override
   *   2. time_entries.pay_rate_cents_snapshot locked at clock-in
   *   3. memberships.pay_rate_cents           current rate
   *
   * The snapshot is what stops a raise silently re-pricing last month, and a
   * contractor deserves that guarantee as much as an employee. Get the order
   * wrong and one shift is worth two different amounts depending on which
   * screen you open.
   *
   * payroll_run_id IS NULL matters just as much: hours already paid out in a
   * finalized run must never reappear here as still owed. That is the
   * double-pay case, and it is the reason this filter is not optional.
   */
  const { data: subs } = (await admin
    .from("memberships")
    .select("id, display_name, pay_rate_cents, profile:profiles ( full_name )")
    .eq("organization_id", organizationId)
    .eq("engagement" as never, "subcontractor" as never)) as unknown as {
    data: Array<{
      id: string;
      display_name: string | null;
      pay_rate_cents: number | null;
      profile: { full_name: string | null } | null;
    }> | null;
  };
  const subById = new Map((subs ?? []).map((m) => [m.id, m]));

  {
    type HourEntry = {
      employee_id: string | null;
      clock_in_at: string | null;
      clock_out_at: string | null;
      pay_rate_cents_snapshot: number | null;
      needs_review: boolean | null;
      booking: { hourly_rate_cents: number | null } | null;
    };
    const ENTRY_COLS =
      "employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, needs_review, booking:bookings ( hourly_rate_cents )";

    // Two fetches, one meaning: hours WORKED under the subcontractor
    // engagement. The snapshot (not the person's current engagement) is
    // what routes an entry here — someone flipped to employee since still
    // has their sub-era hours owed through THIS system, never payroll.
    // NULL snapshots (legacy/missed writer) fall back to the old rule:
    // counted only while the owner is currently a subcontractor.
    const [{ data: eraEntries }, nullRes] = await Promise.all([
      admin
        .from("time_entries")
        .select(ENTRY_COLS as never)
        .eq("organization_id", organizationId)
        .is("payroll_run_id", null)
        // Consumed by a pay-period statement — the statement carries the
        // amount now (counted below while unpaid), not the floating pool.
        .is("subcontractor_run_id" as never, null as never)
        .not("clock_out_at", "is", null)
        .eq("engagement_snapshot" as never, "subcontractor" as never) as unknown as Promise<{
        data: HourEntry[] | null;
      }>,
      subById.size > 0
        ? (admin
            .from("time_entries")
            .select(ENTRY_COLS as never)
            .eq("organization_id", organizationId)
            .is("payroll_run_id", null)
            .is("subcontractor_run_id" as never, null as never)
            .not("clock_out_at", "is", null)
            .is("engagement_snapshot" as never, null as never)
            .in("employee_id", [...subById.keys()]) as unknown as Promise<{
            data: HourEntry[] | null;
          }>)
        : Promise.resolve({ data: [] as HourEntry[] }),
    ]);
    const entries = [...(eraEntries ?? []), ...(nullRes.data ?? [])];

    // Flipped owners aren't in the sub roster fetch above but still need a
    // rate fallback for their legacy-rate rows.
    const missingIds = Array.from(
      new Set(
        entries
          .map((e) => e.employee_id)
          .filter((id): id is string => !!id && !subById.has(id)),
      ),
    );
    const rateById = new Map<string, number | null>(
      [...subById.entries()].map(([id, m]) => [id, m.pay_rate_cents]),
    );
    if (missingIds.length > 0) {
      const { data: extraMembers } = (await admin
        .from("memberships")
        .select("id, pay_rate_cents")
        .in("id", missingIds)
        .eq("organization_id", organizationId)) as unknown as {
        data: Array<{ id: string; pay_rate_cents: number | null }> | null;
      };
      for (const m of extraMembers ?? []) rateById.set(m.id, m.pay_rate_cents);
    }

    for (const e of entries) {
      if (!e.employee_id || !e.clock_in_at || !e.clock_out_at) continue;
      if (!rateById.has(e.employee_id)) continue;
      const k = payeeKey({ kind: "membership", id: e.employee_id });
      // A capped shift is a ceiling, not an observation. Payroll refuses to
      // pay these until an owner confirms them on Timesheets — the same
      // hours must not walk out the door through this screen instead.
      if (e.needs_review) {
        unreviewed.set(k, (unreviewed.get(k) ?? 0) + 1);
        continue;
      }
      const mins = Math.max(
        0,
        Math.round(
          (new Date(e.clock_out_at).getTime() -
            new Date(e.clock_in_at).getTime()) /
            60_000,
        ),
      );
      if (mins === 0) continue;
      const rate =
        e.pay_rate_cents_snapshot ??
        rateById.get(e.employee_id) ??
        0;
      earned.set(k, (earned.get(k) ?? 0) + Math.round((mins * rate) / 60));
      jobCount.set(k, (jobCount.get(k) ?? 0) + 1);
    }
  }

  // Generated-but-unpaid statements still count as owed: freezing a period
  // into a document is not paying it. Marking the run paid retires these in
  // one step (and payouts are for AD-HOC payments — recording one against a
  // statement AND marking it paid would double-reduce the balance).
  {
    const { data: openItems } = (await admin
      .from("subcontractor_pay_items" as never)
      .select("membership_id, total_cents, entry_count, run:subcontractor_pay_runs ( status )")
      .eq("organization_id" as never, organizationId as never)) as unknown as {
      data: Array<{
        membership_id: string;
        total_cents: number;
        entry_count: number;
        run: { status: string } | null;
      }> | null;
    };
    for (const item of openItems ?? []) {
      if (item.run?.status !== "finalized") continue;
      const k = payeeKey({ kind: "membership", id: item.membership_id });
      earned.set(k, (earned.get(k) ?? 0) + (item.total_cents ?? 0));
      jobCount.set(k, (jobCount.get(k) ?? 0) + (item.entry_count ?? 0));
    }
  }

  const { data: payouts } = (await admin
    .from("subcontractor_payouts" as never)
    .select("contact_id, membership_id, amount_cents")
    .eq("organization_id" as never, organizationId as never)) as unknown as {
    data: Array<{
      contact_id: string | null;
      membership_id: string | null;
      amount_cents: number;
    }> | null;
  };
  const paid = new Map<string, number>();
  for (const p of payouts ?? []) {
    // Skipped rather than grouped under a null key. The CHECK constraint makes
    // a payee-less row impossible going forward, but this is what stops one
    // bad row rendering as an "Unnamed" line with a negative balance that
    // quietly drags down the org-wide total.
    const ref: PayeeRef | null = p.membership_id
      ? { kind: "membership", id: p.membership_id }
      : p.contact_id
        ? { kind: "contact", id: p.contact_id }
        : null;
    if (!ref) continue;
    const k = payeeKey(ref);
    paid.set(k, (paid.get(k) ?? 0) + (p.amount_cents ?? 0));
  }

  // Unreviewed keys included: someone whose ONLY unstamped hours are capped
  // shifts still needs a row, or the review chip has nowhere to appear and
  // their hours are invisible on every pay surface at once.
  const keys = [
    ...new Set([...earned.keys(), ...paid.keys(), ...unreviewed.keys()]),
  ];
  if (keys.length === 0) return { rows: [], totalOutstandingCents: 0 };

  const refs = keys.map(parsePayeeKey);

  const contactIds = refs.filter((r) => r.kind === "contact").map((r) => r.id);
  const nameByContact = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: contacts } = (await admin
      .from("freelancer_contacts")
      .select("id, full_name")
      .in("id", contactIds)) as unknown as {
      data: Array<{ id: string; full_name: string | null }> | null;
    };
    for (const c of contacts ?? []) {
      nameByContact.set(c.id, c.full_name ?? "Unnamed");
    }
  }

  // Someone paid as a subcontractor who has since been flipped back to
  // employee still needs a name, or their history renders as "Unnamed".
  const strayIds = refs
    .filter((r) => r.kind === "membership" && !subById.has(r.id))
    .map((r) => r.id);
  const strayNames = new Map<string, string>();
  if (strayIds.length > 0) {
    const { data: extra } = (await admin
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .in("id", strayIds)) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    for (const m of extra ?? []) {
      strayNames.set(m.id, m.display_name ?? m.profile?.full_name ?? "Unnamed");
    }
  }

  const rows: PayableSummary[] = keys
    .map((k) => {
      const payee = parsePayeeKey(k);
      const earnedCents = earned.get(k) ?? 0;
      const paidCents = paid.get(k) ?? 0;
      const member = subById.get(payee.id);
      const name =
        payee.kind === "contact"
          ? (nameByContact.get(payee.id) ?? "Unnamed")
          : (member?.display_name ??
            member?.profile?.full_name ??
            strayNames.get(payee.id) ??
            "Unnamed");
      return {
        payee,
        contactId: payee.kind === "contact" ? payee.id : null,
        isRoster: payee.kind === "membership",
        name,
        earnedCents,
        paidCents,
        outstandingCents: earnedCents - paidCents,
        jobCount: jobCount.get(k) ?? 0,
        unreviewedCount: unreviewed.get(k) ?? 0,
      };
    })
    .sort((a, b) => b.outstandingCents - a.outstandingCents);

  // "Total owed" counts only positive balances — an overpayment to one
  // subcontractor shouldn't reduce what you owe the others.
  const totalOutstandingCents = rows.reduce(
    (s, r) => s + Math.max(0, r.outstandingCents),
    0,
  );

  return { rows, totalOutstandingCents };
}

/** Full ledger for one subcontractor: jobs earned, payouts, and uploaded bills. */
export async function getSubcontractorLedger(
  organizationId: string,
  payee: PayeeRef,
): Promise<SubcontractorLedger> {
  const admin = createSupabaseAdminClient();
  const isMember = payee.kind === "membership";
  const payeeCol = isMember ? "membership_id" : "contact_id";

  const [contactRes, claimsRes, payoutsRes, billsRes] = await Promise.all([
    isMember
      ? admin
          .from("memberships")
          .select(
            "id, display_name, contact_email, contact_phone, profile:profiles ( full_name )",
          )
          .eq("id", payee.id)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : admin
          .from("freelancer_contacts")
          .select("id, full_name, phone, email")
          .eq("id", payee.id)
          .eq("organization_id", organizationId)
          .maybeSingle(),
    // PAID claims belong to the on-call pool only. A roster subcontractor CAN
    // claim an offer (since 20260811), but their claim is just assignment —
    // it carries no flat pay, they clock in like any assigned shift, so their
    // earnings come from time_entries further down. Counting their claims
    // here would be the double-pay bug this module exists to prevent.
    isMember
      ? Promise.resolve({ data: [] })
      : admin
          .from("job_offer_claims" as never)
          .select(
            "offer:job_offers ( id, pay_cents, booking:bookings ( id, status, scheduled_at, service_type ) )",
          )
          .eq("organization_id" as never, organizationId as never)
          .eq("contact_id" as never, payee.id as never),
    admin
      .from("subcontractor_payouts" as never)
      .select("id, amount_cents, paid_on, method, reference, notes")
      .eq("organization_id" as never, organizationId as never)
      .eq(payeeCol as never, payee.id as never)
      .order("paid_on" as never, { ascending: false } as never),
    admin
      .from("subcontractor_bills" as never)
      .select(
        "id, label, amount_cents, bill_date, file_name, file_path, mime_type, created_at",
      )
      .eq("organization_id" as never, organizationId as never)
      .eq(payeeCol as never, payee.id as never)
      .order("created_at" as never, { ascending: false } as never),
  ]);

  const rawRow = contactRes.data as Record<string, unknown> | null;
  const contactRow = rawRow
    ? {
        id: String(rawRow.id),
        full_name: isMember
          ? ((rawRow.display_name as string | null) ??
            ((rawRow.profile as { full_name?: string } | null)?.full_name ??
              null))
          : ((rawRow.full_name as string | null) ?? null),
        phone: (isMember
          ? (rawRow.contact_phone as string | null)
          : (rawRow.phone as string | null)) ?? null,
        email: (isMember
          ? (rawRow.contact_email as string | null)
          : (rawRow.email as string | null)) ?? null,
      }
    : null;

  const claimRows = (claimsRes.data ?? []) as unknown as Array<{
    offer: {
      id: string;
      pay_cents: number | null;
      booking: {
        id: string;
        status: string;
        scheduled_at: string | null;
        service_type: string | null;
      } | null;
    } | null;
  }>;

  const jobs: LedgerJob[] = claimRows
    .filter((c) => c.offer?.booking?.status === "completed")
    .map((c) => ({
      offerId: c.offer!.id,
      bookingId: c.offer!.booking?.id ?? null,
      scheduledAt: c.offer!.booking?.scheduled_at ?? null,
      serviceType: c.offer!.booking?.service_type ?? null,
      payCents: c.offer!.pay_cents ?? 0,
    }))
    .sort((a, b) =>
      (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""),
    );

  const payouts = ((payoutsRes.data ?? []) as unknown as Array<{
    id: string;
    amount_cents: number;
    paid_on: string;
    method: string | null;
    reference: string | null;
    notes: string | null;
  }>).map((p) => ({
    id: p.id,
    amountCents: p.amount_cents,
    paidOn: p.paid_on,
    method: p.method,
    reference: p.reference,
    notes: p.notes,
  }));

  const bills = ((billsRes.data ?? []) as unknown as Array<{
    id: string;
    label: string;
    amount_cents: number | null;
    bill_date: string | null;
    file_name: string;
    file_path: string;
    mime_type: string | null;
    created_at: string;
  }>).map((b) => ({
    id: b.id,
    label: b.label,
    amountCents: b.amount_cents,
    billDate: b.bill_date,
    fileName: b.file_name,
    filePath: b.file_path,
    mimeType: b.mime_type,
    createdAt: b.created_at,
  }));

  // A roster subcontractor's earnings are clocked hours, priced exactly as
  // payroll prices them, and excluding anything already settled in a payroll
  // run. Mirrors getSubcontractorPayables above — the two must agree or the
  // list and the detail page will show different numbers for one person.
  let hourEarnedCents = 0;
  let unreviewedCount = 0;
  let unreviewedMinutes = 0;
  if (isMember) {
    // Member first: whether NULL-snapshot (legacy) entries count depends on
    // their CURRENT engagement — the same rule the org-wide list applies —
    // while subcontractor-era entries count no matter what they are now.
    const { data: member } = (await admin
      .from("memberships")
      .select("pay_rate_cents, engagement")
      .eq("id", payee.id)
      .maybeSingle()) as unknown as {
      data: { pay_rate_cents: number | null; engagement: string | null } | null;
    };
    const countNullSnapshots = member?.engagement === "subcontractor";
    const { data: entries } = (await admin
      .from("time_entries")
      .select(
        "clock_in_at, clock_out_at, pay_rate_cents_snapshot, needs_review, booking:bookings ( hourly_rate_cents )" as never,
      )
      .eq("organization_id", organizationId)
      .eq("employee_id", payee.id)
      .is("payroll_run_id", null)
      .is("subcontractor_run_id" as never, null as never)
      .not("clock_out_at", "is", null)
      .or(
        countNullSnapshots
          ? "engagement_snapshot.eq.subcontractor,engagement_snapshot.is.null"
          : "engagement_snapshot.eq.subcontractor",
      )) as unknown as {
      data: Array<{
        clock_in_at: string | null;
        clock_out_at: string | null;
        pay_rate_cents_snapshot: number | null;
        needs_review: boolean | null;
        booking: { hourly_rate_cents: number | null } | null;
      }> | null;
    };
    for (const e of entries ?? []) {
      if (!e.clock_in_at || !e.clock_out_at) continue;
      const mins = Math.max(
        0,
        Math.round(
          (new Date(e.clock_out_at).getTime() -
            new Date(e.clock_in_at).getTime()) /
            60_000,
        ),
      );
      // Capped shifts: counted so the page can say why the money isn't
      // here, never priced — same rule as the org-wide list and payroll.
      if (e.needs_review) {
        unreviewedCount += 1;
        unreviewedMinutes += mins;
        continue;
      }
      if (mins === 0) continue;
      const rate =
        e.pay_rate_cents_snapshot ??
        member?.pay_rate_cents ??
        0;
      hourEarnedCents += Math.round((mins * rate) / 60);
    }
  }

  // This payee's pay-period statements. Unpaid ones count as owed — the
  // hours left the floating pool when they were stamped, and the statement
  // carries the amount until it's marked paid.
  let statements: SubcontractorLedger["statements"] = [];
  if (isMember) {
    const { data: stmtRows } = (await admin
      .from("subcontractor_pay_items" as never)
      .select(
        "total_cents, minutes, run:subcontractor_pay_runs ( id, period_start, period_end, status, paid_at )",
      )
      .eq("organization_id" as never, organizationId as never)
      .eq("membership_id" as never, payee.id as never)) as unknown as {
      data: Array<{
        total_cents: number;
        minutes: number;
        run: {
          id: string;
          period_start: string;
          period_end: string;
          status: string;
          paid_at: string | null;
        } | null;
      }> | null;
    };
    statements = (stmtRows ?? [])
      .filter((r) => r.run != null)
      .map((r) => ({
        id: r.run!.id,
        periodStart: r.run!.period_start,
        periodEnd: r.run!.period_end,
        totalCents: r.total_cents ?? 0,
        minutes: r.minutes ?? 0,
        status: r.run!.status === "paid" ? ("paid" as const) : ("finalized" as const),
        paidAt: r.run!.paid_at,
      }))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  }
  const openStatementCents = statements
    .filter((s) => s.status === "finalized")
    .reduce((s, r) => s + r.totalCents, 0);

  const earnedCents =
    jobs.reduce((s, j) => s + j.payCents, 0) +
    hourEarnedCents +
    openStatementCents;
  const paidCents = payouts.reduce((s, p) => s + p.amountCents, 0);

  return {
    contact: contactRow
      ? {
          id: contactRow.id,
          name: contactRow.full_name ?? "Unnamed",
          phone: contactRow.phone,
          email: contactRow.email,
        }
      : null,
    jobs,
    payouts,
    bills,
    earnedCents,
    paidCents,
    outstandingCents: earnedCents - paidCents,
    unreviewedCount,
    unreviewedMinutes,
    statements,
  };
}

/**
 * All pay-period statements for an org, items included — the payables page's
 * Statements section. Service-role read; callers gate access.
 */
export type PayRunSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "finalized" | "paid";
  totalCents: number;
  paidAt: string | null;
  createdAt: string;
  items: Array<{
    membershipId: string;
    payeeName: string;
    minutes: number;
    entryCount: number;
    totalCents: number;
  }>;
};

export async function getSubcontractorRuns(
  organizationId: string,
): Promise<PayRunSummary[]> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("subcontractor_pay_runs" as never)
    .select(
      "id, period_start, period_end, status, total_cents, paid_at, created_at, items:subcontractor_pay_items ( membership_id, payee_name, minutes, entry_count, total_cents )",
    )
    .eq("organization_id" as never, organizationId as never)
    .order("period_start" as never, { ascending: false } as never)
    .limit(26)) as unknown as {
    data: Array<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      total_cents: number;
      paid_at: string | null;
      created_at: string;
      items: Array<{
        membership_id: string;
        payee_name: string;
        minutes: number;
        entry_count: number;
        total_cents: number;
      }> | null;
    }> | null;
  };
  return (data ?? []).map((r) => ({
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status === "paid" ? "paid" : "finalized",
    totalCents: r.total_cents,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    items: (r.items ?? [])
      .map((i) => ({
        membershipId: i.membership_id,
        payeeName: i.payee_name,
        minutes: i.minutes,
        entryCount: i.entry_count,
        totalCents: i.total_cents,
      }))
      .sort((a, b) => b.totalCents - a.totalCents),
  }));
}
