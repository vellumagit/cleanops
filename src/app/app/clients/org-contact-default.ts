import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OrgContactDefault } from "@/lib/notification-preferences";

/**
 * The org's house default for automated client messages, for the client form's
 * notification control. Read via the admin client because
 * default_contact_preference isn't in the generated types yet.
 */
export async function fetchOrgContactDefault(
  organizationId: string,
): Promise<OrgContactDefault> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("organizations")
    .select("default_contact_preference")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: { default_contact_preference: string | null } | null;
  };
  const v = data?.default_contact_preference ?? "email";
  return (["email", "sms", "both", "none"].includes(v)
    ? v
    : "email") as OrgContactDefault;
}
