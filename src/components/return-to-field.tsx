"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * Carries "where I came from" through a form submit.
 *
 * Renders a hidden `_return_to` input when the current URL has `?_return=`
 * (a full internal path, usually with its own query string) or the older
 * `?from=setup`. Renders nothing otherwise, so it is safe to drop into any
 * form unconditionally.
 *
 * Pairs with redirectBack() in src/lib/return-to.ts, which validates the
 * value before trusting it.
 */
export function ReturnToField() {
  const searchParams = useSearchParams();

  const explicit = searchParams.get("_return");
  if (explicit) {
    return <input type="hidden" name="_return_to" value={explicit} />;
  }
  // Onboarding's original contract, kept working.
  if (searchParams.get("from") === "setup") {
    return <input type="hidden" name="_return_to" value="setup" />;
  }
  return null;
}

/**
 * The current location as a `_return` value: pathname plus whatever query the
 * page uses to describe itself. That query is the whole point — the scheduler
 * keeps `view` and `week` there, so returning to it restores the exact board
 * the user was looking at.
 *
 * Use from a client component that is rendering a link INTO a form:
 *
 *   const withReturn = useReturnTo();
 *   <Link href={withReturn(`/app/bookings/${id}/edit`)}>Edit</Link>
 */
export function useReturnTo(): (href: string) => string {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (href: string) => {
    const qs = searchParams.toString();
    const here = qs ? `${pathname}?${qs}` : pathname;
    const sep = href.includes("?") ? "&" : "?";
    return `${href}${sep}_return=${encodeURIComponent(here)}`;
  };
}
