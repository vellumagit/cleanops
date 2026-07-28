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
> & {
  /**
   * ADVANCED (per-client): individual messages muted on top of the category
   * channels. The category picks the channel; a mute turns off just that one
   * message for just this client. Lives in the same JSONB as the category
   * overrides — additive, no migration.
   */
  muted_events?: NotificationEvent[];
  /** UI flag: this client's advanced section is revealed in the manager. */
  advanced?: boolean;
};

/**
 * The individual client-facing messages the advanced panel can mute.
 * Each automation key maps to exactly one event (email + SMS variants of the
 * same moment share an event — muting "reminder" mutes both channels).
 */
export type NotificationEvent =
  | "confirmation"
  | "reminder"
  | "rescheduled"
  | "cancelled"
  | "invoice_send"
  | "overdue_reminder"
  | "payment_receipt"
  | "review_request"
  | "gbp_review_request"
  | "rebooking_prompt"
  | "estimate_followup";

export const NOTIFICATION_EVENTS: ReadonlyArray<{
  id: NotificationEvent;
  label: string;
  category: NotificationCategory;
  /**
   * Channels this message actually EXISTS on. Booking moments have email +
   * SMS variants; every billing and growth message is email-only (they carry
   * links, line items, or branded layouts a text can't). The preference
   * resolver doesn't know this — it answers "what is this client willing to
   * receive?" — so honest UI must intersect its answer with this capability
   * or it will claim a text is coming for a message that has no text form.
   */
  channels: ReadonlyArray<"email" | "sms">;
}> = [
  { id: "confirmation", label: "Booking confirmation", category: "booking", channels: ["email", "sms"] },
  { id: "reminder", label: "24-hour reminder", category: "booking", channels: ["email", "sms"] },
  { id: "rescheduled", label: "Reschedule notice", category: "booking", channels: ["email", "sms"] },
  { id: "cancelled", label: "Cancellation notice", category: "booking", channels: ["email", "sms"] },
  { id: "invoice_send", label: "Invoice delivery", category: "billing", channels: ["email", "sms"] },
  { id: "overdue_reminder", label: "Overdue reminders", category: "billing", channels: ["email", "sms"] },
  { id: "payment_receipt", label: "Receipt on payment", category: "billing", channels: ["email", "sms"] },
  { id: "review_request", label: "Review request", category: "growth", channels: ["email"] },
  { id: "gbp_review_request", label: "Google review ask", category: "growth", channels: ["email"] },
  { id: "rebooking_prompt", label: "Rebooking nudge", category: "growth", channels: ["email"] },
  { id: "estimate_followup", label: "Estimate follow-up", category: "growth", channels: ["email"] },
];

/**
 * Which channels a CATEGORY can reach at all — the union of its events'
 * channels. booking: email+sms; billing and growth: email only.
 */
export const CATEGORY_CHANNELS: Record<
  NotificationCategory,
  { email: boolean; sms: boolean }
> = (() => {
  const out = {
    booking: { email: false, sms: false },
    billing: { email: false, sms: false },
    growth: { email: false, sms: false },
  };
  for (const ev of NOTIFICATION_EVENTS) {
    for (const ch of ev.channels) out[ev.category][ch] = true;
  }
  return out;
})();

export type ResolveInput = {
  orgDefault: OrgContactDefault;
  clientPref: ClientContactPreference;
  overrides: ContactOverrides;
  category: NotificationCategory;
  /** The specific message being sent — enables per-client advanced mutes. */
  event?: NotificationEvent;
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
    | "muted_by_client"
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

  // 1b. ADVANCED per-message mute — turns off just this one message for this
  // client, whatever the category channels say.
  if (
    input.event &&
    Array.isArray(overrides.muted_events) &&
    overrides.muted_events.includes(input.event)
  ) {
    return { email: false, sms: false, reason: "muted_by_client" };
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

// ---------------------------------------------------------------------------
// Capability-aware resolution — what will ACTUALLY go out
// ---------------------------------------------------------------------------
// resolveClientChannels answers "what is this client willing to receive?".
// Two more gates decide what really sends, and every UI surface must apply
// them or it lies:
//   1. Channel capability — billing and growth messages exist only as email
//      (CATEGORY_CHANNELS); a "Text" preference there selects silence.
//   2. The org's own SMS master switch (organizations.sms_enabled) — the
//      engine (sendOrgSms) silently skips every text while it's off.
// Engine send-sites don't need this wrapper (each site IS one channel and
// already checks its own gates); these exist so display surfaces all tell
// the same truth.

export type ActualChannels = {
  email: boolean;
  sms: boolean;
  /** resolver reason, or "channel_not_available" when the client's chosen
   *  channel is willing-but-nonexistent (e.g. Text on an email-only
   *  category, or texts while the org's SMS is off). */
  reason: ResolvedChannels["reason"] | "channel_not_available";
};

export function actualClientChannels(
  input: ResolveInput,
  opts?: {
    /** Org can send texts at all (organizations.sms_enabled). Default true. */
    smsAvailable?: boolean;
  },
): ActualChannels {
  const res = resolveClientChannels(input);
  const cap = CATEGORY_CHANNELS[input.category];
  const smsAvailable = opts?.smsAvailable !== false;
  const email = res.email && cap.email;
  const sms = res.sms && cap.sms && smsAvailable;
  if (email || sms) return { email, sms, reason: "ok" };
  // Nothing deliverable. If the resolver WOULD have sent something, the
  // block is capability, not preference — name it distinctly.
  if (res.email || res.sms) {
    return { email: false, sms: false, reason: "channel_not_available" };
  }
  return { email: false, sms: false, reason: res.reason };
}

export function summarizeActualChannels(
  input: Omit<ResolveInput, "category">,
  opts?: { smsAvailable?: boolean },
): Record<NotificationCategory, ActualChannels> {
  const categories: NotificationCategory[] = ["booking", "billing", "growth"];
  const out = {} as Record<NotificationCategory, ActualChannels>;
  for (const category of categories) {
    out[category] = actualClientChannels({ ...input, category }, opts);
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
};
