"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A selection that lives in the URL, and therefore in history.
 *
 * Opening a booking on the calendar or the scheduler used to be plain
 * useState: nothing entered history, so Back left the page entirely and
 * Forward came back with the panel shut — "it doesn't return to the booking
 * I was working on". A panel also couldn't be linked or sent to anyone.
 *
 * Two deliberate differences from useUrlState, which serves a different job:
 *
 *   - It FOLLOWS the URL on every render instead of reading it once and
 *     owning the value. Back and forward have to be able to move it, and a
 *     hook that ignores the URL after mount cannot do that.
 *   - It PUSHES rather than replaces, because an opened panel is somewhere
 *     you can go back from.
 *
 * pushState, not router.push: the scheduler's page reads searchParams, so
 * router.push would re-run the server component and refetch the whole board
 * every time a panel opened. The native History API integrates with the
 * router and stays in sync with useSearchParams without firing an RSC
 * request — the same reason use-url-state.ts reaches for replaceState.
 */
export function useUrlSelection(
  key: string,
): [string | null, (next: string | null) => void] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(key);

  const set = useCallback(
    (next: string | null) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (next) params.set(key, next);
      else params.delete(key);
      const qs = params.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      // Re-selecting what is already selected must not stack duplicate
      // entries — otherwise closing a panel takes as many Backs as the
      // number of times it was clicked.
      if (href === `${window.location.pathname}${window.location.search}`) {
        return;
      }
      window.history.pushState(null, "", href);
    },
    [key, pathname],
  );

  return [value, set];
}
