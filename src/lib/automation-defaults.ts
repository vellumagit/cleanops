/**
 * Default-state policy for per-org automation toggles.
 *
 * Most automations default to ENABLED — a fresh org gets the full
 * out-of-the-box experience and owners turn off the ones they don't
 * want. A small number default to DISABLED instead: automations that
 * touch the org's CLIENTS (emails, SMS, etc.) where we'd rather the
 * owner consciously opt in than surprise clients during onboarding
 * while data is still being configured.
 *
 * Rules for adding an entry to DEFAULT_OFF:
 *   - The automation sends something to the client (not to the owner
 *     or crew).
 *   - It fires often enough that silent enablement could embarrass the
 *     owner mid-onboarding.
 *   - It's not compensating for a safety mechanism — e.g. overdue
 *     reminders default ON because they're a revenue lever.
 *
 * Adding a key here quietly flips every existing org that hasn't
 * explicitly set this automation. Document the change loudly.
 */
/**
 * HISTORICAL. Automations are now opt-in across the board (see
 * resolveAutomationEnabled), so this set no longer decides anything at runtime.
 * It's retained because migration 20260723010000 froze exactly these keys to
 * `false` when grandfathering existing orgs — keep it as the record of what the
 * old defaults were.
 */
export const DEFAULT_OFF: ReadonlySet<string> = new Set([
  // Sent to the client when a booking is created. Owners often create
  // draft/test bookings while onboarding before their client list is
  // clean; quiet until explicitly enabled.
  "booking_confirmation_email",

  // System feed events — auto-posts from booking/job activity default OFF.
  // Owners see only real human posts unless they explicitly opt in.
  "system_feed_events",

  // The feed feature itself (the /app/feed + /field/feed pages, the
  // sidebar links). Default OFF so fresh orgs aren't asked to manage
  // a social-style feed during onboarding — they can opt in if they
  // want a shared team-update space. When false the sidebar links
  // are hidden and the routes return notFound().
  "feed_visible",

  // SMS automations — all default OFF. SMS is a higher-friction channel
  // than email: clients may not have opted in to texts, and A2P 10DLC
  // registration must be complete before the platform-level
  // TWILIO_ENABLED flag is flipped. Owners explicitly opt these in once
  // they're registered and have confirmed clients welcome texts.
  "booking_confirmation_sms",
  "booking_reminder_client_sms",
  "booking_assignment_sms",
  // Reschedule/cancel texts. When ON, an opted-in client gets the TEXT instead
  // of the email (channel preference, not both). Default OFF like every other
  // SMS automation, so the email keeps going out until the owner opts in.
  "booking_rescheduled_sms",
  "booking_cancelled_sms",

  // Scheduling preference (internal, not client-facing): auto-divide team-job
  // hours across the crew in the field app. Opt-in — off until the owner
  // turns it on, so existing orgs keep showing full durations by default.
  "divide_crew_hours",
]);

/**
 * Shared resolver used by both the runtime gate (src/lib/automations.ts)
 * and the settings UI (src/app/app/settings/automations/page.tsx) so
 * they always agree on "is this on right now?"
 *
 * AUTOMATIONS ARE OPT-IN. A key with no explicit setting is OFF. A fresh org
 * therefore does nothing until the owner turns on the master switch and picks
 * the automations they want — no surprise emails/texts to a client list that's
 * still being imported, and no background money actions they didn't ask for.
 *
 * Existing orgs were grandfathered by migration 20260723010000, which wrote an
 * explicit true/false for every key they hadn't set — explicit always wins, so
 * their behaviour was unchanged by this flip.
 *
 * NOTE: this resolver only answers "is this key on?". The org-level master
 * switch (organizations.automations_enabled) is checked separately by
 * isAutomationEnabled() in automations.ts and overrides everything here.
 */
export function resolveAutomationEnabled(
  settings:
    | Record<string, { enabled?: boolean } | undefined>
    | null
    | undefined,
  key: string,
): boolean {
  return settings?.[key]?.enabled === true;
}

/**
 * Everything defaults off now. Kept as a function (rather than deleting the
 * concept) so the settings UI can keep labelling defaults without every call
 * site changing.
 */
export function isDefaultOff(_key: string): boolean {
  return true;
}
