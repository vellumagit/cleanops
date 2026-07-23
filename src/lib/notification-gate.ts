import "server-only";
import {
  resolveClientChannels,
  type NotificationCategory,
  type ResolvedChannels,
  type OrgContactDefault,
  type ClientContactPreference,
  type ContactOverrides,
} from "@/lib/notification-preferences";

/**
 * Runtime bridge between the pure policy engine (notification-preferences.ts)
 * and the automations. Loads the org default + the client's preference, then
 * resolves the channels for one category. Self-contained so wiring it into a
 * send function is a single call + a branch — no reshaping the existing selects.
 *
 * Precedence lives ABOVE this: callers still check the platform pause and the
 * per-org automation toggle first. This only answers "given this automation is
 * on, may we reach THIS client, on which channel?".
 */

export type ClientNotifyDecision = ResolvedChannels & {
  clientEmail: string | null;
  clientPhone: string | null;
  clientName: string | null;
};

/**
 * Resolve notification channels for a client + category.
 *
 * `db` is the Supabase admin client. It's typed loosely (matching this repo's
 * `as unknown as` convention) because contact_preference/contact_overrides
 * aren't in the generated types yet, and the full client type is too deep to
 * instantiate here. Results are cast explicitly below.
 *
 * Pass an `orgDefaultCache` (a Map you keep for the batch) so a cron that
 * touches many clients in the same org only fetches the org default once.
 */
export async function resolveClientNotify(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: {
    organizationId: string;
    clientId: string | null;
    category: NotificationCategory;
    orgDefaultCache?: Map<string, OrgContactDefault>;
  },
): Promise<ClientNotifyDecision> {
  const nothing = (
    reason: ResolvedChannels["reason"],
  ): ClientNotifyDecision => ({
    email: false,
    sms: false,
    reason,
    clientEmail: null,
    clientPhone: null,
    clientName: null,
  });

  if (!args.clientId) return nothing("no_reachable_channel");

  let orgDefault = args.orgDefaultCache?.get(args.organizationId);
  if (orgDefault === undefined) {
    const { data: org } = (await db
      .from("organizations")
      .select("default_contact_preference")
      .eq("id", args.organizationId)
      .maybeSingle()) as { data: { default_contact_preference?: string } | null };
    orgDefault = (org?.default_contact_preference ??
      "email") as OrgContactDefault;
    args.orgDefaultCache?.set(args.organizationId, orgDefault);
  }

  const { data: client } = (await db
    .from("clients")
    .select(
      "name, email, phone, sms_opted_in, contact_preference, contact_overrides",
    )
    .eq("id", args.clientId)
    .maybeSingle()) as {
    data: {
      name: string | null;
      email: string | null;
      phone: string | null;
      sms_opted_in: boolean | null;
      contact_preference: string | null;
      contact_overrides: ContactOverrides | null;
    } | null;
  };

  if (!client) return nothing("no_reachable_channel");

  const resolved = resolveClientChannels({
    orgDefault,
    clientPref: (client.contact_preference ??
      "inherit") as ClientContactPreference,
    overrides: (client.contact_overrides ?? {}) as ContactOverrides,
    category: args.category,
    hasEmail: Boolean(client.email),
    smsOptedIn: Boolean(client.sms_opted_in),
  });

  return {
    ...resolved,
    clientEmail: client.email ?? null,
    clientPhone: client.phone ?? null,
    clientName: client.name ?? null,
  };
}
