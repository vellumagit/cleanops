/**
 * When did a tap actually happen?
 *
 * A clock-in on a phone with one bar can take a minute to reach the server,
 * or fail and be sent again from the truck at 9:40. The time that matters is
 * when she tapped, so the phone sends it (`tapped_at`) and the server trusts
 * it — within reason. A phone clock that is wrong, or a tap from a page that
 * sat open since yesterday, falls back to the server's clock.
 */

/** How far in the past a tap may claim to be. Covers a long dead zone. */
export const MAX_TAP_AGE_MS = 12 * 60 * 60_000;
/** Phone clocks run a little fast; anything further ahead is a wrong clock. */
export const MAX_TAP_SKEW_MS = 5 * 60_000;

export function punchTime(
  tappedAt: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (tappedAt) {
    const t = new Date(tappedAt).getTime();
    if (
      Number.isFinite(t) &&
      t >= nowMs - MAX_TAP_AGE_MS &&
      t <= nowMs + MAX_TAP_SKEW_MS
    ) {
      return new Date(t).toISOString();
    }
  }
  return new Date(nowMs).toISOString();
}

/** The form field the field app sends. One name, used everywhere. */
export const TAPPED_AT_FIELD = "tapped_at";
