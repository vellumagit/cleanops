/**
 * What an office person can turn down: the topics the office's notices are
 * sorted into, and reading someone's choices.
 *
 * Asked for in person on 2026-11-19: the office gets a lot of notices, and
 * each owner, admin and manager should be able to choose what reaches them.
 * Cleaners get no such choice: what they are sent, they need.
 *
 * Muting a topic stops the phone alert and the email for it. The bell inside
 * the app still lists everything, so nothing is lost, only quieter.
 *
 * A notice with no topic is always delivered. That is on purpose for the few
 * that mean something is broken until someone acts: texting paused, the
 * calendar disconnected, an invoice that could not be sent. It is also the
 * safe default for a notice nobody has sorted yet.
 *
 * Pure, so the rules are tested without a database. The choices live in
 * memberships.notification_prefs as { muted_topics: [...] }.
 */

export const OFFICE_TOPICS = [
  {
    key: "schedule",
    label: "Schedule",
    description:
      "A shift nobody has taken, a cleaner who declined or hasn't confirmed, a job whose date passed, tomorrow's problems.",
  },
  {
    key: "clock",
    label: "Clocking in and out",
    description: "Someone who hasn't clocked in, a shift left running, a shift that was closed automatically.",
  },
  {
    key: "time_off",
    label: "Time off",
    description: "A time-off request, a day someone marked unavailable, time off that was cancelled.",
  },
  {
    key: "clients",
    label: "Clients",
    description:
      "New requests and website inquiries, a client's note or text, an estimate answered, a contract signed, a new review.",
  },
  {
    key: "money",
    label: "Money",
    description: "Invoices held or voided, payments and refunds, payroll ready for review, bonuses.",
  },
  {
    key: "team",
    label: "Team",
    description: "Feedback from the team, someone deactivated.",
  },
] as const;

export type OfficeTopic = (typeof OFFICE_TOPICS)[number]["key"];

const KEYS = new Set<string>(OFFICE_TOPICS.map((t) => t.key));

export const isOfficeTopic = (value: unknown): value is OfficeTopic =>
  typeof value === "string" && KEYS.has(value);

/** The topics this person has turned down. Anything unreadable is "none":
 *  a damaged setting must never silence someone. */
export function readMutedTopics(prefs: unknown): Set<OfficeTopic> {
  const list = (prefs as { muted_topics?: unknown } | null | undefined)?.muted_topics;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter(isOfficeTopic));
}

/** What to store for a set of muted topics: known ones only, in a fixed order. */
export function mutedTopicsPrefs(muted: Iterable<unknown>): { muted_topics: OfficeTopic[] } {
  const chosen = new Set([...muted].filter(isOfficeTopic));
  return { muted_topics: OFFICE_TOPICS.map((t) => t.key).filter((k) => chosen.has(k)) };
}

/** Does a notice on this topic still alert someone with these choices? */
export function alertsFor(prefs: unknown, topic: OfficeTopic | undefined): boolean {
  return !topic || !readMutedTopics(prefs).has(topic);
}
