/**
 * Per-client notification policy — the single source of truth for "should this
 * automated message go to this client, and on which channel(s)?".
 *
 * This is a PURE function (no I/O) so it's exhaustively unit-testable — the
 * whole point of centralising the policy is that "why didn't X send?" has one
 * answer, not one per call site.
 *
 * The model is default + override:
 *   - Org sets a house default (organizations.default_contact_preference).
 *   - Each client is `inherit` (follow the default), `custom` (per-category
 *     channels), or `do_not_contact` (nothing, ever, automated).
 *   - Automations are grouped into 3 categories the owner actually thinks in:
 *     booking / billing / growth.
 *
 * Consent vs preference: a PREFERENCE is routing ("text this client"); it is
 * NOT permission. SMS only ever sends when the client has actually opted in
 * (clients.sms_opted_in) — TCPA/CTIA/CASL. A preference of SMS on a
 * non-opted-in client resolves to "nothing" (product decision: no silent
 * cross-channel fallback), and the caller surfaces "send opt-in request".
 */

export type OrgContactDefault = "email" | "sms" | "both" | "none";
export type ClientContactPreference = "inherit" | "custom" | "do_not_contact";

/** Per-category channel choice in a client's `custom` config. */
export type CategoryChannel = "off" | "email" | "sms" | "both" | "inherit";

/** The three buckets every client-facing automation maps to. */
export type NotificationCategory = "booking" | "billing" | "growth";

export type ContactOverrides = Partial<
  Record<NotificationCategory, CategoryChannel>
>;

export type ResolveInput = {
  orgDefault: OrgContactDefault;
  clientPref: ClientContactPreference;
  overrides: ContactOverrides;
  category: NotificationCategory;
  /** Client has a usable email on file. */
  hasEmail: boolean;
  /** Client has actually opted in to SMS (the consent gate, not a preference). */
  smsOptedIn: boolean;
};

export type ResolvedChannels = {
  email: boolean;
  sms: boolean;
  /**
   * Machine-readable reason, for the notification log + "why didn't it send?".
   * "ok" when at least one channel will send.
   */
  reason:
    | "ok"
    | "do_not_contact"
    | "category_off"
    | "sms_not_opted_in"
    | "no_email_address"
    | "no_reachable_channel";
};

/** Collapse an org default into a concrete channel choice. */
function orgDefaultToChannel(
  d: OrgContactDefault,
): "off" | "email" | "sms" | "both" {
  return d === "none" ? "off" : d;
}

/**
 * Resolve which channels an automated message should use for one client in one
 * category. See file header for the model. Never throws.
 */
export function resolveClientChannels(input: ResolveInput): ResolvedChannels {
  const { clientPref, overrides, category, orgDefault, hasEmail, smsOptedIn } =
    input;

  // 1. Do not contact wins over everything (automated).
  if (clientPref === "do_not_contact") {
    return { email: false, sms: false, reason: "do_not_contact" };
  }

  // 2. What channel does the client WANT for this category?
  //    inherit → the org default applies to every category.
  //    custom  → the per-category override, which may itself be "inherit".
  let desired: "off" | "email" | "sms" | "both";
  if (clientPref === "custom") {
    const ov = overrides[category] ?? "inherit";
    desired = ov === "inherit" ? orgDefaultToChannel(orgDefault) : ov;
  } else {
    desired = orgDefaultToChannel(orgDefault);
  }

  if (desired === "off") {
    return { email: false, sms: false, reason: "category_off" };
  }

  // 3. Gate by capability/consent. NO cross-channel fallback (product decision:
  //    if the preferred channel can't send, stay silent — don't surprise the
  //    client on a channel they didn't choose).
  const wantEmail = desired === "email" || desired === "both";
  const wantSms = desired === "sms" || desired === "both";

  const email = wantEmail && hasEmail;
  const sms = wantSms && smsOptedIn;

  if (email || sms) {
    return { email, sms, reason: "ok" };
  }

  // 4. Nothing will send — give the most specific reason for the log.
  if (wantSms && !wantEmail && !smsOptedIn) {
    return { email: false, sms: false, reason: "sms_not_opted_in" };
  }
  if (wantEmail && !wantSms && !hasEmail) {
    return { email: false, sms: false, reason: "no_email_address" };
  }
  return { email: false, sms: false, reason: "no_reachable_channel" };
}

/**
 * "What sends" preview for the client settings UI — resolves every category at
 * once so the owner reads the OUTCOME, not just the switches.
 */
export function summarizeClientChannels(
  input: Omit<ResolveInput, "category">,
): Record<NotificationCategory, ResolvedChannels> {
  const categories: NotificationCategory[] = ["booking", "billing", "growth"];
  const out = {} as Record<NotificationCategory, ResolvedChannels>;
  for (const category of categories) {
    out[category] = resolveClientChannels({ ...input, category });
  }
  return out;
}

/** Maps an automation key to its category. Central so wiring can't drift. */
export const AUTOMATION_CATEGORY: Record<string, NotificationCategory> = {
  // Booking lifecycle
  booking_confirmation_email: "booking",
  booking_confirmation_sms: "booking",
  booking_reminder_client_email: "booking",
  booking_reminder_client_sms: "booking",
  booking_rescheduled_email: "booking",
  booking_rescheduled_sms: "booking",
  booking_cancelled_email: "booking",
  booking_cancelled_sms: "booking",
  // Billing
  invoice_auto_send: "billing",
  invoice_paid_receipt: "billing",
  invoice_overdue_reminder: "billing",
  // Growth
  rebooking_prompt_email: "growth",
  review_request_after_completion: "growth",
  gbp_review_request: "growth",
  estimate_followup_email: "growth",
  estimate_sent_email: "growth",
};
