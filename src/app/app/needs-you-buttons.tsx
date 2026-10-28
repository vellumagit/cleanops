"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import type { NeedsYouAction } from "@/lib/needs-you-items";
import {
  closeJobAction,
  snoozeItemAction,
  removeMemberAction,
  clockOutAtAction,
  restoreSeriesTimesAction,
  keepSeriesTimesAction,
} from "./needs-you-actions";

const btn =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-50";
const primary = `${btn} bg-foreground text-background hover:opacity-90`;
const secondary = `${btn} border border-border bg-background text-foreground hover:bg-muted`;

export function NeedsYouButtons({ actions }: { actions: NeedsYouAction[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(a: NeedsYouAction) {
    startTransition(async () => {
      let r: { ok: true } | { ok: false; error: string } = { ok: true };
      switch (a.kind) {
        case "close_job":
          r = await closeJobAction(a.bookingId);
          break;
        case "snooze":
          r = await snoozeItemAction(a.key, a.untilIso);
          break;
        case "remove_member":
          if (!window.confirm("Take her off this job? Her hours, if any, stay on the timesheet.")) return;
          r = await removeMemberAction(a.bookingId, a.membershipId);
          break;
        case "clock_out_at":
          r = await clockOutAtAction(a.entryId, a.bookingId, a.atIso);
          break;
        case "restore_series_times":
          if (
            !window.confirm(
              `Move ${a.count} ${a.count === 1 ? "visit" : "visits"} back to the series' time? Nobody is notified; calendars update overnight.`,
            )
          )
            return;
          r = await restoreSeriesTimesAction(a.seriesId);
          break;
        case "keep_series_times":
          r = await keepSeriesTimesAction(a.seriesId);
          break;
        default:
          return;
      }
      if (r.ok) {
        toast.success("Done");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((a, i) => {
        if (a.kind === "link") {
          return (
            <Link key={i} href={a.href} className={i === 0 ? primary : secondary}>
              {a.label}
            </Link>
          );
        }
        if (a.kind === "call") {
          return (
            <a key={i} href={`tel:${a.phone}`} className={secondary}>
              <Phone className="h-3.5 w-3.5" />
              {a.label}
            </a>
          );
        }
        return (
          <button
            key={i}
            type="button"
            disabled={isPending}
            onClick={() => run(a)}
            className={i === 0 ? primary : secondary}
          >
            {isPending ? "…" : a.label}
          </button>
        );
      })}
    </div>
  );
}
