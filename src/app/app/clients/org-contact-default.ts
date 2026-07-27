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
    .select("default_contact_preference, automation_mode")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: {
      default_contact_preference: string | null;
      automation_mode: string | null;
    } | null;
  };
  // Per-client routing mode: unconfigured clients receive nothing, so every
  // UI surface (client card, list badges, edit control) should read the
  // effective default as "none".
  if (data?.automation_mode === "per_client") return "none";
  const v = data?.default_contact_preference ?? "email";
  return (["email", "sms", "both", "none"].includes(v)
    ? v
    : "email") as OrgContactDefault;
}

/**
 * Default + routing mode together, for surfaces whose copy changes by mode
 * (the client profile card). fetchOrgContactDefault stays for callers that
 * only need the resolved channel default.
 */
export async function fetchOrgNotificationContext(
  organizationId: string,
): Promise<{ orgDefault: OrgContactDefault; perClientMode: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data } = (await admin
    .from("organizations")
    .select("default_contact_preference, automation_mode")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as {
    data: {
      default_contact_preference: string | null;
      automation_mode: string | null;
    } | null;
  };
  const perClientMode = data?.automation_mode === "per_client";
  if (perClientMode) return { orgDefault: "none", perClientMode };
  const v = data?.default_contact_preference ?? "email";
  return {
    orgDefault: (["email", "sms", "both", "none"].includes(v)
      ? v
      : "email") as OrgContactDefault,
    perClientMode,
  };
}
