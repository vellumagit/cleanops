"use client";

import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { inactiveCrewWarning } from "@/lib/crew-eligibility";

/**
 * The warning sign beside a booking's crew when someone on it has been
 * deactivated. Hover (or tap, or focus) for who and what to do. Renders
 * nothing when everyone is active.
 *
 * A real button, so it can be reached by keyboard and opens on a tap where
 * there is no hover. The same words are its accessible name and its
 * `title`, so they are there even if the popup is not.
 */
export function InactiveCrewWarning({
  names,
  isSeries,
}: {
  /** People on this booking who are no longer active. */
  names: string[];
  isSeries: boolean;
}) {
  const text = inactiveCrewWarning(names, isSeries);
  if (!text) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={text}
            title={text}
            // Rows and cards are links: the sign is for reading, not for
            // opening the booking.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="inline-flex shrink-0 cursor-help items-center rounded-sm align-middle text-amber-600 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-amber-400"
          />
        }
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
