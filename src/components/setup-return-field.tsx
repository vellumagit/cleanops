"use client";

import { useSearchParams } from "next/navigation";

/**
 * Drops a hidden `_return_to=setup` input into a form when the current
 * URL has `?from=setup`. Paired with `redirectAfterSetup()` /
 * `maybeRedirectToSetup()` on the server to bounce the user back to
 * /app/setup after they complete a step.
 *
 * Renders nothing when the user didn't come from setup, so it's safe to
 * drop into any form unconditionally.
 */
export function SetupReturnField() {
  const searchParams = useSearchParams();
  if (searchParams.get("from") !== "setup") return null;
  return <input type="hidden" name="_return_to" value="setup" />;
}
