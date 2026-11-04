import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * What the public texting policy pages say about one business: its name and
 * how customers reach it. From the US registration when there is one (the
 * names the carriers were given), else the org's own profile. Nothing else
 * about the org is read, because these pages are public.
 */
export async function loadTextingPolicyBusiness(orgId: string): Promise<{
  name: string;
  phone: string | null;
  email: string | null;
} | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return null;
  const db = createSupabaseAdminClient();
  const [{ data: org }, { data: reg }] = await Promise.all([
    db
      .from("organizations")
      .select("name, contact_phone, contact_email")
      .eq("id", orgId)
      .maybeSingle() as unknown as Promise<{
      data: { name: string | null; contact_phone: string | null; contact_email: string | null } | null;
    }>,
    db
      .from("sms_registrations" as never)
      .select("details")
      .eq("organization_id" as never, orgId as never)
      .maybeSingle() as unknown as Promise<{ data: { details: Record<string, string> } | null }>,
  ]);
  if (!org) return null;
  const d = reg?.details ?? {};
  return {
    name: d.brand_name || d.legal_name || org.name || "This business",
    phone: d.support_phone || org.contact_phone || null,
    email: d.support_email || org.contact_email || null,
  };
}

export function formatUsPhone(e164: string | null): string | null {
  if (!e164) return null;
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}
