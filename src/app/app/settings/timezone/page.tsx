import Link from "next/link";
import { ArrowLeft, Globe2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { getOrgTimezone, COMMON_TIMEZONES } from "@/lib/org-timezone";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { TimezoneForm } from "./form";

export const metadata = { title: "Timezone" };

export default async function TimezonePage() {
  const membership = await requireMembership(["owner", "admin"]);
  const currentTz = await getOrgTimezone(membership.organization_id);

  // Preview: what does "now" look like in the current timezone?
  const nowInTz = new Date().toLocaleString("en-US", {
    timeZone: currentTz,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <PageShell
      title="Timezone"
      description="Times entered by your team (booking start times, recurrence schedules) are interpreted in this timezone. Stored in UTC in the database, so changing this won't shift any existing booking — future ones honor the new value."
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
        <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <div className="text-muted-foreground">
          Right now in <strong className="text-foreground">{currentTz}</strong>:{" "}
          <strong className="text-foreground">{nowInTz}</strong>
        </div>
      </div>
      <TimezoneForm currentTz={currentTz} options={COMMON_TIMEZONES} />
    </PageShell>
  );
}
