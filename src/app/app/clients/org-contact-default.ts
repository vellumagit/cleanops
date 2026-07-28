import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OrgContactDefault } from "@/lib/notification-preferences";

/**
 * The org's house default for client notifications — what an "inherit"
 * client receives. "none" means unconfigured clients get nothing (orgs
 * migrated from the retired per-client routing mode land here).
 *
 * Cached per-request: several cards on one page ask for this.
 */
export const fetchOrgContactDefault = cache(
  async (organizationId: string): Promise<OrgContactDefault> => {
    const ctx = await fetchOrgNotificationContext(organizationId);
    return ctx.orgDefault;
  },
);

export const fetchOrgNotificationContext = cache(
  async (
    organizationId: string,
  ): Promise<{
    orgDefault: OrgContactDefault;
    /** organizations.sms_enabled — texts silently skip while this is off. */
    smsEnabled: boolean;
  }> => {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("organizations")
      .select("default_contact_preference, sms_enabled")
      .eq("id", organizationId)
      .maybeSingle()) as unknown as {
      data: {
        default_contact_preference: string | null;
        sms_enabled: boolean | null;
      } | null;
    };
    const v = data?.default_contact_preference ?? "email";
    return {
      orgDefault: (["email", "sms", "both", "none"].includes(v)
        ? v
        : "email") as OrgContactDefault,
      smsEnabled: data?.sms_enabled === true,
    };
  },
);
