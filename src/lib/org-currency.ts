import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CurrencyCode } from "@/lib/format";

/**
 * Fetch the display currency for an organization. Cached per-request via
 * React's `cache()` so a page that calls this multiple times (e.g. passing
 * the currency to 4 different components) hits the DB once.
 *
 * Falls back to "CAD" on any error — currency is a display concern, not a
 * correctness one, so we never want a failed lookup to break rendering.
 */
export const getOrgCurrency = cache(
  async (organizationId: string): Promise<CurrencyCode> => {
    try {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from("organizations")
        .select("currency_code")
        .eq("id", organizationId)
        .maybeSingle();

      const code = (data as { currency_code?: string } | null)?.currency_code;
      return code === "USD" ? "USD" : "CAD";
    } catch {
      return "CAD";
    }
  },
);
