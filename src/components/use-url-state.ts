"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * View state that lives in the URL instead of component state.
 *
 * The bookings list kept its tab, search and four filters in useState, so the
 * redirect back from the editor remounted it with everything reset — you set
 * tab=past, searched a cleaner's name, filtered to completed, opened a row to
 * fix it, and came back to an empty upcoming list. It also meant a filtered
 * view could not be bookmarked or sent to anyone.
 *
 * Uses window.history.replaceState rather than router.replace: the Next docs
 * confirm both integrate with the router and stay in sync with
 * useSearchParams (linking-and-navigating.md:345), but replaceState does not
 * fire an RSC request — which matters for a search box that updates on every
 * keystroke.
 *
 * Defaults are omitted from the URL, so an untouched list stays on a clean
 * /app/bookings rather than accumulating ?tab=upcoming&status=all&…
 */
export function useUrlState<T extends string>(
  key: string,
  fallback: T,
): [T, (next: T) => void] {
  const searchParams = useSearchParams();

  // Read once on mount. After that this component owns the value; the URL is
  // a mirror, not a second source of truth.
  const [value, setValue] = useState<T>(
    () => (searchParams.get(key) as T | null) ?? fallback,
  );

  const set = useCallback(
    (next: T) => {
      setValue(next);
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (!next || next === fallback) params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
    },
    [key, fallback],
  );

  return [value, set];
}
