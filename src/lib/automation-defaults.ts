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
export const DEFAULT_OFF: ReadonlySet<string> = new Set([
  // Sent to the client when a booking is created. Owners often create
  // draft/test bookings while onboarding before their client list is
  // clean; quiet until explicitly enabled.
  "booking_confirmation_email",
]);

/**
 * Shared resolver used by both the runtime gate (src/lib/automations.ts)
 * and the settings UI (src/app/app/settings/automations/page.tsx) so
 * they always agree on "is this on right now?"
 *
 * Precedence:
 *   1. Explicit setting in organizations.automation_settings wins.
 *   2. Absent setting → DEFAULT_OFF membership decides: off if in the
 *      set, on otherwise.
 */
export function resolveAutomationEnabled(
  settings:
    | Record<string, { enabled?: boolean } | undefined>
    | null
    | undefined,
  key: string,
): boolean {
  const explicit = settings?.[key]?.enabled;
  if (explicit === true) return true;
  if (explicit === false) return false;
  return !DEFAULT_OFF.has(key);
}

/** Does this key default to OFF when no explicit setting exists? */
export function isDefaultOff(key: string): boolean {
  return DEFAULT_OFF.has(key);
}
