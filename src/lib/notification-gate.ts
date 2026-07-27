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
    const { data: org, error: orgErr } = (await db
      .from("organizations")
      .select("default_contact_preference, automation_mode")
      .eq("id", args.organizationId)
      .maybeSingle()) as {
      data: {
        default_contact_preference?: string;
        automation_mode?: string | null;
      } | null;
      error: { message: string } | null;
    };
    if (orgErr) {
      // Fail toward the safe default (email) but say so — a silent fallback
      // here is indistinguishable from a configured "email" org (audit B9).
      console.error(
        `[notify-gate] org default lookup failed for ${args.organizationId} (falling back to email):`,
        orgErr.message,
      );
    }
    // PER-CLIENT routing mode: an unconfigured ("inherit") client gets
    // NOTHING — the client's own settings are the only way a client-facing
    // message sends. Modelled as an effective org default of "none".
    orgDefault =
      org?.automation_mode === "per_client"
        ? "none"
        : ((org?.default_contact_preference ?? "email") as OrgContactDefault);
    args.orgDefaultCache?.set(args.organizationId, orgDefault);
  }

  const { data: client, error: clientErr } = (await db
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
    error: { message: string } | null;
  };

  if (clientErr) {
    // A transient DB error must not read as "client has no channels" without
    // a trace — for one-shot triggers the notice is permanently lost, and
    // this log line is the only way to know why (audit B9).
    console.error(
      `[notify-gate] client lookup failed for ${args.clientId} (suppressing send):`,
      clientErr.message,
    );
  }
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
