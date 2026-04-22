import "server-only";

import { redirect } from "next/navigation";

/**
 * Onboarding return-to helper.
 *
 * Each setup step on /app/setup links to a form with `?from=setup`. A tiny
 * client component (<SetupReturnField>) reads that query param and injects
 * a hidden `_return_to=setup` input into the form. The server actions for
 * those forms call `redirectAfterSetup()` below so a save bounces the user
 * back to /app/setup (where they see the step newly checked) instead of
 * stranding them on the list page.
 *
 * For actions that currently return state instead of redirecting,
 * `maybeRedirectToSetup()` is the safe no-op when the user didn't come
 * from setup.
 */

/**
 * Redirect to /app/setup when the form came from the setup flow; otherwise
 * fall back to the caller-provided URL. `redirect()` throws NEXT_REDIRECT,
 * so this never returns — the `never` type reflects that.
 */
export function redirectAfterSetup(
  formData: FormData,
  fallback: string,
): never {
  const returnTo = String(formData.get("_return_to") ?? "");
  if (returnTo === "setup") {
    redirect("/app/setup");
  }
  redirect(fallback);
}

/**
 * For actions that don't currently redirect (they return state for the
 * form to show a toast). If the user came from setup, bounce them back;
 * otherwise let the caller keep returning state as before.
 *
 * Call this right before `return { success: true }` and it will either
 * redirect or no-op.
 */
export function maybeRedirectToSetup(formData: FormData): void {
  const returnTo = String(formData.get("_return_to") ?? "");
  if (returnTo === "setup") {
    redirect("/app/setup");
  }
}
