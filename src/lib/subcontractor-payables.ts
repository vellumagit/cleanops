import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  contactId: string;
  name: string;
  earnedCents: number;
  paidCents: number;
  outstandingCents: number;
  jobCount: number;
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
};

/**
 * Org-wide list of subcontractors with a balance, plus the total still owed.
 * Includes anyone who has earned or been paid; sorted by outstanding desc.
 */
export async function getSubcontractorPayables(
  organizationId: string,
): Promise<{ rows: PayableSummary[]; totalOutstandingCents: number }> {
  const admin = createSupabaseAdminClient();

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

  const earned = new Map<string, number>();
  const jobCount = new Map<string, number>();
  for (const c of claims ?? []) {
    if (c.offer?.booking?.status === "completed") {
      earned.set(c.contact_id, (earned.get(c.contact_id) ?? 0) + (c.offer.pay_cents ?? 0));
      jobCount.set(c.contact_id, (jobCount.get(c.contact_id) ?? 0) + 1);
    }
  }

  const { data: payouts } = (await admin
    .from("subcontractor_payouts" as never)
    .select("contact_id, amount_cents")
    .eq("organization_id" as never, organizationId as never)) as unknown as {
    data: Array<{ contact_id: string; amount_cents: number }> | null;
  };
  const paid = new Map<string, number>();
  for (const p of payouts ?? []) {
    paid.set(p.contact_id, (paid.get(p.contact_id) ?? 0) + (p.amount_cents ?? 0));
  }

  const contactIds = [...new Set([...earned.keys(), ...paid.keys()])];
  if (contactIds.length === 0) return { rows: [], totalOutstandingCents: 0 };

  const { data: contacts } = (await admin
    .from("freelancer_contacts")
    .select("id, full_name")
    .in("id", contactIds)) as unknown as {
    data: Array<{ id: string; full_name: string | null }> | null;
  };
  const nameById = new Map<string, string>();
  for (const c of contacts ?? []) nameById.set(c.id, c.full_name ?? "Unnamed");

  const rows: PayableSummary[] = contactIds
    .map((id) => {
      const earnedCents = earned.get(id) ?? 0;
      const paidCents = paid.get(id) ?? 0;
      return {
        contactId: id,
        name: nameById.get(id) ?? "Unnamed",
        earnedCents,
        paidCents,
        outstandingCents: earnedCents - paidCents,
        jobCount: jobCount.get(id) ?? 0,
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
  contactId: string,
): Promise<SubcontractorLedger> {
  const admin = createSupabaseAdminClient();

  const [contactRes, claimsRes, payoutsRes, billsRes] = await Promise.all([
    admin
      .from("freelancer_contacts")
      .select("id, full_name, phone, email")
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin
      .from("job_offer_claims" as never)
      .select(
        "offer:job_offers ( id, pay_cents, booking:bookings ( id, status, scheduled_at, service_type ) )",
      )
      .eq("organization_id" as never, organizationId as never)
      .eq("contact_id" as never, contactId as never),
    admin
      .from("subcontractor_payouts" as never)
      .select("id, amount_cents, paid_on, method, reference, notes")
      .eq("organization_id" as never, organizationId as never)
      .eq("contact_id" as never, contactId as never)
      .order("paid_on" as never, { ascending: false } as never),
    admin
      .from("subcontractor_bills" as never)
      .select(
        "id, label, amount_cents, bill_date, file_name, file_path, mime_type, created_at",
      )
      .eq("organization_id" as never, organizationId as never)
      .eq("contact_id" as never, contactId as never)
      .order("created_at" as never, { ascending: false } as never),
  ]);

  const contactRow = contactRes.data as {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;

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

  const earnedCents = jobs.reduce((s, j) => s + j.payCents, 0);
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
  };
}
