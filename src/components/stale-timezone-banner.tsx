"use client";

import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { findTzMismatch, type TzMismatch, type TzProbe } from "@/lib/tz-probe";

const DISMISS_KEY = "stale-tz-dismissed-on";

/**
 * Warns when this device's timezone rules disagree with the server's — see
 * lib/tz-probe.ts. Renders nothing until it has checked, so server HTML and
 * the first client render always match. Dismissable for the day only: the
 * times stay wrong until the device updates, so it comes back tomorrow.
 */
export function StaleTimezoneBanner({ probe }: { probe: TzProbe }) {
  const [mismatch, setMismatch] = useState<TzMismatch | null>(null);

  useEffect(() => {
    const found = findTzMismatch(probe);
    if (!found) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(DISMISS_KEY) === today) return;
    } catch {
      // Storage blocked: show it every time, which is the safe side.
    }
    // A one-off read of the device's clock rules, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMismatch(found);
  }, [probe]);

  if (!mismatch) return null;

  const hours = Math.abs(mismatch.diffMinutes) / 60;
  const amount =
    hours === 1 ? "an hour" : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
  const direction = mismatch.diffMinutes < 0 ? "early" : "late";
  const example = new Date(mismatch.at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString().slice(0, 10));
    } catch {
      // Nothing to remember it in; hiding it for this page view is enough.
    }
    setMismatch(null);
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          This device has out-of-date time zone rules.
        </p>
        <p className="mt-0.5 text-amber-800 dark:text-amber-200">
          {`Job times from ${example} on show ${amount} ${direction} here. Update this browser, or your phone's software, then reopen Sollos. Until then, double-check start times with the office.`}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide for today"
        className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
