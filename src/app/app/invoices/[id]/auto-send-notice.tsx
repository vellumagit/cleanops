"use client";

import { Clock } from "lucide-react";

/**
 * Blue notice on a draft invoice that's scheduled to auto-send, showing the
 * send time in the viewer's local timezone. Pure render from the ISO prop (no
 * Date.now / effects); suppressHydrationWarning covers the expected
 * server(UTC)-vs-client(local) difference in the formatted string.
 */
export function AutoSendNotice({ iso }: { iso: string }) {
  const when = new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mt-4 flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-200">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span suppressHydrationWarning>
        Auto-sends {when}. Edit it any time before then — whatever it says when
        the timer&apos;s up is what ships. Or hold it.
      </span>
    </div>
  );
}
