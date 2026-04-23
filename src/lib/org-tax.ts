import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type OrgTaxDefaults = {
  /** Rate in basis points or null for no default. */
  rateBps: number | null;
  /** Label like "GST" or null. */
  label: string | null;
};

/**
 * Fetch the org's default tax settings for pre-filling new invoices.
 * Returns { rateBps: null, label: null } when the owner hasn't
 * configured a default in Settings → Currency & tax.
 */
export async function getOrgTaxDefaults(
  organizationId: string,
): Promise<OrgTaxDefaults> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("default_tax_rate_bps, default_tax_label")
    .eq("id", organizationId)
    .maybeSingle() as unknown as {
    data: {
      default_tax_rate_bps: number | null;
      default_tax_label: string | null;
    } | null;
  };

  return {
    rateBps: data?.default_tax_rate_bps ?? null,
    label: data?.default_tax_label ?? null,
  };
}

/**
 * Format a bps rate as a percent string suitable for pre-filling a
 * text input. 500 → "5", 1250 → "12.5". Empty string when null.
 */
export function taxRateBpsToPercentString(
  rateBps: number | null | undefined,
): string {
  if (!rateBps) return "";
  return (rateBps / 100).toFixed(2).replace(/\.?0+$/, "");
}
