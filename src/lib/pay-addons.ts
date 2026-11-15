/**
 * Add-ons: a fixed amount for one contractor on one day (travel, a parking
 * receipt, supplies bought). Preparing the pay period puts each on that
 * person's statement, on top of their hours. See the migration
 * 20261115030000_pay_addons.sql for why they exist.
 *
 * The pure part, so the money is tested without a database.
 */

export type AddonKind = "reimbursement" | "travel" | "other";

export const ADDON_KINDS: ReadonlyArray<{ key: AddonKind; label: string }> = [
  { key: "reimbursement", label: "Reimbursement" },
  { key: "travel", label: "Travel" },
  { key: "other", label: "Other" },
];

export const ADDON_LABEL: Record<AddonKind, string> = {
  reimbursement: "Reimbursement",
  travel: "Travel",
  other: "Other",
};

export function isAddonKind(v: unknown): v is AddonKind {
  return v === "reimbursement" || v === "travel" || v === "other";
}

/** Largest single add-on: $10,000. A typo guard, not a policy. */
export const MAX_ADDON_CENTS = 1_000_000;

export type AddonRow = {
  id: string;
  membership_id: string;
  kind: AddonKind;
  amount_cents: number;
};

export type AddonTotals = {
  addonsCents: number;
  reimbursementCents: number;
  ids: string[];
};

/** Per person: what their add-ons come to, how much is reimbursement, and which rows. */
export function totalAddons(rows: readonly AddonRow[]): Map<string, AddonTotals> {
  const out = new Map<string, AddonTotals>();
  for (const r of rows) {
    if (!(r.amount_cents > 0)) continue;
    const t = out.get(r.membership_id) ?? { addonsCents: 0, reimbursementCents: 0, ids: [] };
    t.addonsCents += r.amount_cents;
    if (r.kind === "reimbursement") t.reimbursementCents += r.amount_cents;
    t.ids.push(r.id);
    out.set(r.membership_id, t);
  }
  return out;
}

/** "$25.00" from "25", "$25", "25.5", "1,200.00"; null for anything else or zero. */
export function parseAddonAmount(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_ADDON_CENTS) return null;
  return cents;
}
