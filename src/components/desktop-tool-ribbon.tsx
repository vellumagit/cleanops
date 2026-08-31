"use client";

import { usePathname } from "next/navigation";
import { Monitor } from "lucide-react";
import { tierForPath } from "@/components/app-nav";

/**
 * Slim notice on desktop-tier pages when opened on a phone. Deliberately
 * informational, never a gate: the day someone genuinely needs to mark a
 * payroll run paid from a beach, a ribbon they scroll past is a feature
 * and a wall is a support call. Tier comes from the nav manifest, so a
 * page's classification lives in exactly one place.
 */
export function DesktopToolRibbon() {
  const pathname = usePathname();
  if (tierForPath(pathname) !== "desktop") return null;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground lg:hidden">
      <Monitor className="h-3.5 w-3.5 shrink-0" />
      <span>Built for a bigger screen — everything works here, it&apos;s just easier at a desk.</span>
    </div>
  );
}
