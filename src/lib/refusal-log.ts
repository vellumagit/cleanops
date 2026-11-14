/**
 * What the app told someone when it said no: the shared rules for the
 * record (migration 20261114010000_refusal_log.sql). Pure; the writer is
 * /api/refusals and the reader is the morning check.
 */

export const REFUSAL_MESSAGE_MAX = 600;
export const REFUSAL_PATH_MAX = 300;
export type RefusalKind = "toast" | "alert";

/** Ids in a path say which record, not what happened; fold them so the same
 *  screen groups together ("/app/bookings/:id/edit"). */
export function refusalPath(pathname: string): string {
  return pathname
    .split("?")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .slice(0, REFUSAL_PATH_MAX);
}

/** One line of text, bounded. Null when there is nothing worth keeping. */
export function refusalMessage(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 3) return null;
  return clean.slice(0, REFUSAL_MESSAGE_MAX);
}

export type RefusalRow = { message: string; path: string; created_at: string; membership_id: string | null };

/**
 * Yesterday's refusals for the report: each distinct message once, most
 * frequent first, with how often, on which screen, and how many people.
 * Names and dates inside a message vary, so messages are grouped by their
 * opening words: "Olha Musnytska is already booked then: …" and "Vira
 * Karpynska is already booked then: …" are one kind of refusal.
 */
export function summarizeRefusals(rows: RefusalRow[], limit = 8): { total: number; lines: string[] } {
  const groups = new Map<string, { n: number; sample: string; paths: Set<string>; people: Set<string> }>();
  for (const r of rows) {
    const key = refusalKey(r.message);
    const g = groups.get(key) ?? { n: 0, sample: r.message, paths: new Set<string>(), people: new Set<string>() };
    g.n++;
    g.paths.add(r.path);
    if (r.membership_id) g.people.add(r.membership_id);
    groups.set(key, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.n - a.n);
  const lines = sorted.slice(0, limit).map((g) => {
    const who = g.people.size > 1 ? `, ${g.people.size} people` : "";
    const where = [...g.paths].slice(0, 2).join(", ");
    return `   ×${String(g.n).padEnd(3)} ${g.sample.slice(0, 150)}${g.sample.length > 150 ? "…" : ""}\n          on ${where}${who}`;
  });
  if (sorted.length > limit) lines.push(`   … and ${sorted.length - limit} other message(s)`);
  return { total: rows.length, lines };
}

/**
 * What makes two messages "the same refusal": their words with the names,
 * numbers and dates taken out. Names, months and sentence openings are
 * capitalised and the refusal's own words are not, so only the words that
 * start in lower case are kept: "Olha Musnytska is already booked then:
 * Nancy Whitson, Dec 4, 2026 · 9:00 AM." and the same for anyone else both
 * come out as "is already booked then".
 */
export function refusalKey(message: string): string {
  const own = message
    .split(/\s+/)
    .filter((w) => /^[a-z]/.test(w))
    .map((w) => w.replace(/[^a-z']/g, ""))
    .filter(Boolean);
  // A message with almost no lower-case words (a short label) is its own key.
  return own.length >= 3 ? own.join(" ") : message.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The same words from the same screen inside this window are one refusal
 * seen more than once (a toast and its box, a re-render, the recorder's two
 * looks after a submit, the last of which is 4 seconds on). Past it, the
 * same words again are the person trying again, which is the signal.
 */
export const REFUSAL_REPEAT_MS = 5000;
