import "server-only";

import { redirect, RedirectType } from "next/navigation";

/**
 * Return-to-origin for forms that are reachable from several places.
 *
 * The booking editor has ONE route and EIGHT ways in — the scheduler's week,
 * month and day grids, the bookings list (table, cards, keyboard), the
 * calendar, and the booking detail page. Every one of them used to land on
 * /app/bookings after Save, so opening a job from Tuesday's 9am slot and
 * fixing the time dumped you on a list with the week, the dialog and your
 * scroll position gone.
 *
 * The mechanism, which generalizes src/lib/setup-return.ts:
 *   1. the link that opens the form appends ?_return=<current path + query>
 *   2. <ReturnToField> renders it as a hidden `_return_to` input
 *   3. the server action ends with redirectBack(formData, fallback)
 *
 * The onboarding flow's `?from=setup` keeps working — it is a special case
 * inside the same helper, so setup-return.ts's callers are unaffected.
 */

/** Roots a return path may point at. Anything else is treated as hostile. */
const SAFE_RETURN_PREFIXES = ["/app", "/field"];

/**
 * Validate an untrusted return path.
 *
 * This is the open-redirect guard from the login flow
 * (src/app/(marketing)/login/actions.ts), applied to the PATH portion only so
 * a legitimate query string — which is the entire point here, since it carries
 * the week, the view and the filters — still survives.
 *
 * Returns the safe path (with its query) or null.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const [path] = value.split("?");

  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  if (path.includes("\\")) return null;
  // A percent-encoded slash or backslash in the PATH is a normalization trick;
  // in the query it is ordinary data, which is why this checks `path` only.
  if (/%2f/i.test(path) || /%5c/i.test(path)) return null;

  const allowed = SAFE_RETURN_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return allowed ? value : null;
}

/**
 * Send the user back where they came from, or to `fallback`.
 *
 * Always replaces rather than pushes: the form we are leaving has been
 * consumed, and leaving it on the history stack is what made Back land on the
 * page you just saved. `redirect()` throws NEXT_REDIRECT, so this never
 * returns.
 */
export function redirectBack(formData: FormData, fallback: string): never {
  const raw = String(formData.get("_return_to") ?? "");

  // Onboarding's existing contract.
  if (raw === "setup") redirect("/app/setup", RedirectType.replace);

  redirect(safeReturnPath(raw) ?? fallback, RedirectType.replace);
}

/**
 * For actions that return state instead of redirecting: bounce only if the
 * user actually came from somewhere, otherwise no-op and let the caller keep
 * returning its own result.
 */
export function maybeRedirectBack(formData: FormData): void {
  const raw = String(formData.get("_return_to") ?? "");
  if (raw === "setup") redirect("/app/setup", RedirectType.replace);
  const path = safeReturnPath(raw);
  if (path) redirect(path, RedirectType.replace);
}
