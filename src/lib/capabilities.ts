/**
 * What THIS manager does — not what managers do.
 *
 * "Manager" is one rung on a ladder and a real team is not a ladder. Olha is
 * not blocked by anything; the opposite. She can read every number in the
 * business, and most of them are none of her job. Svitlana wants to say who
 * schedules, who runs timesheets, and who has any business reading invoices.
 *
 * The rules, in one place because the alternative is six places that agree
 * until they don't:
 *
 *   owner, admin  everything, always. Deliberately NOT togglable — an owner
 *                 who can switch off their own books is a support ticket.
 *   manager       exactly what is switched on for them. NULL/absent means
 *                 unrestricted, which is every manager who existed before
 *                 this feature, so nothing changed the day it shipped.
 *   employee      none of it. The field app is their surface, gated
 *                 elsewhere.
 *
 * ALTITUDE. This gates the application: pages, server actions, navigation. It
 * is not a second row-level-security layer. RLS still answers "whose ORG's
 * rows are these", which is what keeps tenants apart. Unticking `invoicing`
 * takes it out of a manager's app; it does not stop someone technical from
 * querying the API with their own token. For dividing work inside one trusted
 * team, that is the right altitude — and saying so here means nobody later
 * mistakes it for a security boundary it was never built to be.
 */

export const MANAGER_CAPABILITIES = [
  {
    key: "scheduling",
    label: "Scheduling",
    description:
      "The scheduler and calendar: create, move and assign jobs, offer shifts, change job status.",
  },
  {
    key: "timesheets",
    label: "Timesheets & time off",
    description:
      "Hours worked, editing time entries, approving time-off requests. Includes what each person earned for those hours.",
  },
  {
    key: "invoicing",
    label: "Invoices & estimates",
    description:
      "Invoices, estimates, payments and client balances — the money side. Turn this off for a manager who runs jobs but has no business reading the books.",
  },
  {
    key: "clients",
    label: "Client records",
    description:
      "Client profiles, properties, contact details and notes. Turning this off still lets them see the client's name on a job they are scheduling.",
  },
  {
    key: "subcontractors",
    label: "On-call pool & subcontractor pay",
    description:
      "The on-call cleaner list, shift offers to them, and what subcontractors are owed.",
  },
] as const;

export type CapabilityKey = (typeof MANAGER_CAPABILITIES)[number]["key"];

export const CAPABILITY_KEYS = MANAGER_CAPABILITIES.map(
  (c) => c.key,
) as readonly CapabilityKey[];

/** Stored shape: {"scheduling": true, "invoicing": false}. */
export type CapabilityMap = Partial<Record<CapabilityKey, boolean>> | null;

type Roleish = string | null | undefined;

/**
 * May this person use this area?
 *
 * Absence means yes for a manager, on purpose: a key nobody has decided about
 * — because the feature is new, or because a capability was added after they
 * were set up — should not silently take away access they had yesterday.
 * That is the opposite default from automations (strict opt-in), and for the
 * opposite reason: there, a surprise is an email to a client; here, a
 * surprise is a manager locked out mid-shift with no idea why.
 */
export function hasCapability(
  role: Roleish,
  capabilities: CapabilityMap | undefined,
  key: CapabilityKey,
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role !== "manager") return false;
  return capabilities?.[key] !== false;
}

/** Every capability this person actually has, for menus and summaries. */
export function grantedCapabilities(
  role: Roleish,
  capabilities: CapabilityMap | undefined,
): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((k) => hasCapability(role, capabilities, k));
}

/**
 * True when someone has deliberately narrowed this manager — used to show
 * "Full access" versus a list, without mistaking a fresh manager for a
 * restricted one.
 */
export function isRestricted(
  role: Roleish,
  capabilities: CapabilityMap | undefined,
): boolean {
  if (role !== "manager") return false;
  return CAPABILITY_KEYS.some((k) => capabilities?.[k] === false);
}

/**
 * Read a stored JSONB value into the map, discarding anything that isn't a
 * known key or a boolean. The column is JSONB, so what comes back is whatever
 * was last written — including by hand, in the SQL editor, at 1am.
 */
export function parseCapabilities(raw: unknown): CapabilityMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Partial<Record<CapabilityKey, boolean>> = {};
  for (const key of CAPABILITY_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Build the value to store from a form's checked keys. */
export function capabilitiesFromForm(
  checkedKeys: readonly string[],
): CapabilityMap {
  const out: Partial<Record<CapabilityKey, boolean>> = {};
  for (const key of CAPABILITY_KEYS) {
    out[key] = checkedKeys.includes(key);
  }
  return out;
}
