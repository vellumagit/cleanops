"use client";

/**
 * GpsConsentBanner
 *
 * Shown to field employees until they acknowledge that GPS coordinates are
 * recorded on clock-in / clock-out. Renders a sticky amber notice with a
 * "Got it" button that calls acceptGpsConsentAction() and then hides itself.
 *
 * Acceptance is stored server-side (memberships.gps_consent_accepted_at) so
 * the banner stays gone across sessions and devices.
 */

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptGpsConsentAction } from "@/app/field/jobs/actions";

export function GpsConsentBanner({
  needsConsent,
}: {
  needsConsent: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!needsConsent || hidden) return null;

  function handleAccept() {
    startTransition(async () => {
      await acceptGpsConsentAction();
      setHidden(true);
    });
  }

  return (
    <div className="sticky top-0 z-50 flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1 text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Location notice: </span>
        When you start or complete a job your GPS coordinates are recorded to
        confirm on-site presence. This data is visible only to your employer
        and is not shared with third parties.
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
        onClick={handleAccept}
        disabled={isPending}
      >
        {isPending ? "Saving…" : "Got it"}
      </Button>
    </div>
  );
}
