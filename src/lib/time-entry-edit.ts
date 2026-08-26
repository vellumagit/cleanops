/**
 * Pure helpers for editing an existing time entry.
 *
 * Both exist because a clock punch carries sub-second precision and the edit
 * form does not. `<input type="datetime-local">` round-trips minutes by
 * default and seconds at best — never milliseconds — so a save that changed
 * nothing still rewrote the stored instant slightly earlier. Svit's field app
 * produces back-to-back punches (clock out of one job, into the next, a
 * fraction of a second apart), so "slightly earlier" was enough to push a
 * start back across the previous entry's end and trip the overlap guard.
 * The owner then could not save the row at all without falsifying the hours.
 */

/**
 * Keep the stored instant when the submitted one is just a lower-precision
 * reading of it.
 *
 * The edit form's inputs are MINUTE-granular on purpose. They used to carry
 * step="1" so the browser kept seconds — which also rendered a third
 * spinner, and Svitlana's keystrokes spilled into it: an evening of edits
 * left 20:30:30, 23:10:10, 17:29:31 where she typed :00, and a "3:30" that
 * read back 3:31. Minute inputs kill the spinner; this helper keeps the
 * original protection: a submitted value equal to the stored timestamp
 * truncated to the MINUTE means the field wasn't edited, so the stored
 * instant survives with its full sub-second precision (back-to-back punches
 * land fractions apart — truncating them used to trip the overlap guard).
 * Any genuine edit lands on a different minute and passes through exactly
 * as typed.
 */
export function preserveWithinMinute(
  submitted: string | null,
  stored: string | null | undefined,
): string | null {
  if (!submitted || !stored) return submitted;
  const storedMs = Date.parse(stored);
  const submittedMs = Date.parse(submitted);
  if (!Number.isFinite(storedMs) || !Number.isFinite(submittedMs)) {
    return submitted;
  }
  return Math.floor(storedMs / 60_000) * 60_000 === submittedMs
    ? stored
    : submitted;
}

/**
 * Does an entry that ends at `otherEnd` reach past `startIso`?
 *
 * `otherEnd` null means the shift is still running, which the caller's
 * docstring has always described as "extending to the current moment" — so
 * that is what it does here. The previous implementation coalesced open
 * entries to the year 9999 instead, which contradicted the documented
 * behaviour and would outlive the future-dated-entry guard that currently
 * hides the difference.
 *
 * Compares instants, not strings. PostgREST returns `+00:00` where
 * `Date.toISOString()` returns `Z`, and Postgres omits the fractional part
 * when it is zero — so `2026-08-04T18:56:56+00:00` sorted BELOW the identical
 * `2026-08-04T18:56:56.000Z` on a lexicographic compare ('+' < '.'), and a
 * real overlap read as clean.
 *
 * An unparseable timestamp yields false: one bad row should be ignored by the
 * overlap check, never freeze every edit for that employee.
 */
export function endsAfterStart(
  otherEnd: string | null,
  startIso: string,
  nowMs: number,
): boolean {
  const end = otherEnd === null ? nowMs : Date.parse(otherEnd);
  const start = Date.parse(startIso);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return false;
  return end > start;
}
