import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberDisplayName } from "@/lib/member-display";

/**
 * What the business still owes its cleaners in tips.
 *
 * A tip paid by card lands in the org's own Stripe balance — that is simply
 * how a destination charge works — so between collection and payday the
 * business is holding money that belongs to someone else. This is the ledger
 * for that, and the only thing standing between a client's gratuity and the
 * person it was meant for.
 */

export type TipOwedRow = {
  membershipId: string | null;
  name: string;
  amountCents: number;
  tipCount: number;
};

export type TipsOwed = {
  rows: TipOwedRow[];
  totalCents: number;
  /** Paid but not attributable to anyone — needs an owner's decision. */
  unattributedCents: number;
};

const EMPTY: TipsOwed = { rows: [], totalCents: 0, unattributedCents: 0 };

export async function getTipsOwed(organizationId: string): Promise<TipsOwed> {
  try {
    const admin = createSupabaseAdminClient();

    const { data: tips } = (await admin
      .from("invoice_tips" as never)
      .select("membership_id, amount_cents")
      .eq("organization_id" as never, organizationId as never)
      .is("paid_out_at" as never, null as never)) as unknown as {
      data: Array<{
        membership_id: string | null;
        amount_cents: number;
      }> | null;
    };

    if (!tips || tips.length === 0) return EMPTY;

    const byMember = new Map<string | null, { cents: number; count: number }>();
    for (const t of tips) {
      const cur = byMember.get(t.membership_id) ?? { cents: 0, count: 0 };
      cur.cents += t.amount_cents;
      cur.count += 1;
      byMember.set(t.membership_id, cur);
    }

    const memberIds = [...byMember.keys()].filter(Boolean) as string[];
    const { data: members } = memberIds.length
      ? ((await admin
          .from("memberships")
          .select("id, display_name, profile:profiles ( full_name )")
          .in("id", memberIds)) as unknown as {
          data: Array<{
            id: string;
            display_name: string | null;
            profile: { full_name: string | null } | null;
          }> | null;
        })
      : { data: [] };

    const nameById = new Map(
      (members ?? []).map((m) => [m.id, memberDisplayName(m)]),
    );

    const rows: TipOwedRow[] = [...byMember.entries()]
      .map(([membershipId, v]) => ({
        membershipId,
        name: membershipId
          ? (nameById.get(membershipId) ?? "Unknown")
          : "Not yet assigned",
        amountCents: v.cents,
        tipCount: v.count,
      }))
      .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));

    return {
      rows,
      totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
      unattributedCents:
        rows.find((r) => r.membershipId === null)?.amountCents ?? 0,
    };
  } catch (err) {
    console.error("[tips] getTipsOwed failed:", err);
    return EMPTY;
  }
}

/** Every tip recorded against one invoice, for the detail page. */
export async function getInvoiceTips(invoiceId: string): Promise<{
  totalCents: number;
  rows: Array<{
    name: string;
    amountCents: number;
    paidOut: boolean;
    /** Settled INTO the business (owner override) rather than handed over. */
    kept: boolean;
  }>;
}> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("invoice_tips" as never)
      .select(
        "amount_cents, paid_out_at, kept_by_business, membership:memberships ( display_name, profile:profiles ( full_name ) )",
      )
      .eq("invoice_id" as never, invoiceId as never)) as unknown as {
      data: Array<{
        amount_cents: number;
        paid_out_at: string | null;
        kept_by_business: boolean | null;
        membership: {
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      }> | null;
    };

    const rows = (data ?? []).map((r) => ({
      name: r.membership ? memberDisplayName(r.membership) : "Not yet assigned",
      amountCents: r.amount_cents,
      paidOut: Boolean(r.paid_out_at),
      kept: Boolean(r.kept_by_business),
    }));

    return {
      totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
      rows,
    };
  } catch (err) {
    console.error("[tips] getInvoiceTips failed:", err);
    return { totalCents: 0, rows: [] };
  }
}
