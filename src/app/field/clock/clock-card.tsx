"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  Briefcase,
  Clock as ClockIcon,
  LogIn,
  LogOut,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { clockInAction, clockOutAction } from "./actions";
import { startJobAction, completeJobAction } from "../jobs/actions";
import { JobCardComplete } from "../jobs/job-card-complete";
import { useElapsed, formatElapsed, STALE_SHIFT_MS } from "../use-elapsed";

type Coords = { lat: number | null; lng: number | null };

// Categories for an off-job clock-in (not tied to a booking). Nothing is
// preselected — every punch is an explicit choice. Order differs by who's
// clocking: for managers "Manager / admin" really is the common answer; for
// a cleaner it's the least likely one and sits last (a hardcoded default
// here once put twelve phantom admin rows on one cleaner's timesheet).
const ELEVATED_CATEGORIES = [
  { key: "manager", label: "Manager / admin" },
  { key: "training", label: "Training" },
  { key: "travel", label: "Travel" },
  { key: "supplies", label: "Supplies / errand" },
  { key: "other", label: "Other" },
];
const CREW_CATEGORIES = [
  { key: "travel", label: "Travel" },
  { key: "supplies", label: "Supplies / errand" },
  { key: "training", label: "Training" },
  { key: "other", label: "Other" },
  { key: "manager", label: "Manager / admin" },
];

export type TodayJob = {
  id: string;
  clientName: string;
  serviceLabel: string;
  timeLabel: string;
};

/**
 * Badge the installed-PWA icon with hours on the clock, so the shift is
 * visible without opening anything. Supported on Android/Chrome and on iOS
 * 16.4+ for home-screen installs; a silent no-op everywhere else.
 */
function useAppBadge(hoursOnClock: number | null) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    if (hoursOnClock == null) {
      nav.clearAppBadge().catch(() => {});
      return;
    }
    // Badge counters render poorly above 2 digits; hours is the useful unit.
    nav.setAppBadge(Math.max(1, hoursOnClock)).catch(() => {});
  }, [hoursOnClock]);
}

async function getCoords(): Promise<Coords> {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    return { lat: null, lng: null };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}

function buildFormData(coords: Coords, category?: string, note?: string) {
  const fd = new FormData();
  if (coords.lat != null) fd.set("lat", String(coords.lat));
  if (coords.lng != null) fd.set("lng", String(coords.lng));
  if (category) fd.set("work_category", category);
  if (note) fd.set("note", note);
  return fd;
}

export function ClockCard({
  isClockedIn,
  openSinceIso,
  openBookingLabel,
  openBookingId,
  tz,
  elevated,
  todaysJobs,
  nextJob,
}: {
  /** Org IANA timezone. Without it this rendered in the PHONE's zone, which
   *  is accidentally right for a local cleaner and wrong for anyone whose
   *  device is set elsewhere — and it disagreed with the shift history
   *  directly beneath it, which uses the org's. */
  tz: string;
  isClockedIn: boolean;
  openSinceIso: string | null;
  openBookingLabel: string | null;
  /** Set when the open shift belongs to a job — changes what "done" means. */
  openBookingId: string | null;
  /** Orders the category list — managers see "Manager / admin" first,
   *  everyone else sees it last. Nobody gets a preselected answer. */
  elevated: boolean;
  /** The member's assigned jobs today — the one-tap right answers. */
  todaysJobs: TodayJob[];
  /** While clocked into a job: the next assigned job whose start has
   *  arrived, offered as one tap that finishes this one and starts it. */
  nextJob: TodayJob | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const categories = elevated ? ELEVATED_CATEGORIES : CREW_CATEGORIES;
  const readyToClockIn =
    category !== "" && (category !== "other" || note.trim().length >= 3);

  const elapsedMs = useElapsed(isClockedIn ? openSinceIso : null);
  useAppBadge(elapsedMs == null ? null : Math.floor(elapsedMs / 3_600_000));
  // Past this the shift is almost certainly a forgotten clock-out rather than
  // a long day — say so on the card instead of waiting for the nightly cap.
  const looksStale = elapsedMs != null && elapsedMs > STALE_SHIFT_MS;

  function handleIn() {
    startTransition(async () => {
      const coords = await getCoords();
      const result = await clockInAction(
        buildFormData(coords, category, note.trim()),
      );
      if (result.ok) {
        toast.success("Clocked in");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRollover(next: TodayJob) {
    if (!openBookingId) return;
    startTransition(async () => {
      const coords = await getCoords();
      const done = buildFormData(coords);
      done.set("booking_id", openBookingId);
      const finish = await completeJobAction(done);
      if (!finish.ok) {
        toast.error(finish.error);
        return;
      }
      const start = buildFormData(coords);
      start.set("booking_id", next.id);
      const started = await startJobAction(start);
      if (started.ok) {
        toast.success(`Done — clocked in at ${next.clientName}`);
      } else {
        // The finish landed; only the next clock-in failed. Say exactly that.
        toast.error(`Job finished, but couldn't start ${next.clientName}: ${started.error}`);
      }
      router.refresh();
    });
  }

  function handleStartJob(job: TodayJob) {
    startTransition(async () => {
      const coords = await getCoords();
      const fd = buildFormData(coords);
      fd.set("booking_id", job.id);
      const result = await startJobAction(fd);
      if (result.ok) {
        toast.success(`Clocked in — ${job.clientName}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleOut() {
    startTransition(async () => {
      const coords = await getCoords();
      const result = await clockOutAction(buildFormData(coords));
      if (result.ok) {
        toast.success("Clocked out");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        <div
          className={
            isClockedIn
              ? "flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
          }
        >
          <ClockIcon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">
            {isClockedIn ? "On the clock" : "Off the clock"}
          </p>
          {isClockedIn && openSinceIso ? (
            <>
              <p className="text-sm text-muted-foreground">
                {/* Elapsed FIRST — it's the number that tells you something is
                    wrong. The weekday matters just as much: "8:04 AM" alone
                    reads as this morning even on day three. */}
                {elapsedMs != null && (
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatElapsed(elapsedMs)}
                  </span>
                )}
                {elapsedMs != null ? " · started " : "Started "}
                {new Date(openSinceIso).toLocaleString("en-US", {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: tz,
                })}
                {openBookingLabel ? ` · ${openBookingLabel}` : ""}
              </p>
              {looksStale && (
                <p className="mt-1 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                  This shift has been running a long time — if you finished
                  earlier, clock out and tell your manager the real time.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tap below to start your shift.
            </p>
          )}
        </div>
      </div>

      {!isClockedIn && (
        <div className="mt-5 space-y-4">
          {todaysJobs.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Clock in for one of today&apos;s jobs
              </div>
              <div className="flex flex-col gap-2">
                {todaysJobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => handleStartJob(job)}
                    className="flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-left transition-colors hover:bg-muted active:bg-muted disabled:opacity-50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {job.clientName}
                        </span>
                        {job.serviceLabel && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {job.serviceLabel}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                      {job.timeLabel}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {todaysJobs.length > 0
                ? "Not a job? Pick what this time is for"
                : "Pick what this time is for"}
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() =>
                    setCategory((cur) => (cur === c.key ? "" : c.key))
                  }
                  className={
                    category === c.key
                      ? "rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                      : "rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted active:text-foreground"
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
            {category === "other" && (
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="A few words about what you're doing…"
                maxLength={500}
                className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            )}
          </div>
        </div>
      )}

      <div className="mt-5">
        {isClockedIn && openBookingId ? (
          /*
           * On a JOB, the right action is finishing the job — not a bare
           * clock-out. Clocking out here stops the clock but leaves the
           * booking sitting in "in progress" forever, which is its own
           * warning on the owner's bookings list. Lead with the job, and
           * label the fallback honestly rather than offering two buttons
           * that look equivalent and aren't.
           */
          <div className="flex flex-col gap-2">
            {nextJob && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleRollover(nextJob)}
                className="flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-sky-300/60 bg-sky-500/10 px-3 text-left transition-colors hover:bg-sky-500/20 disabled:opacity-50 dark:border-sky-900/50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-sky-800 dark:text-sky-300">
                    Done here? Start {nextJob.clientName}
                  </span>
                  <span className="block truncate text-[11px] text-sky-800/70 dark:text-sky-300/70">
                    {nextJob.serviceLabel
                      ? `${nextJob.serviceLabel} · `
                      : ""}
                    {nextJob.timeLabel} — finishes this job first
                  </span>
                </span>
              </button>
            )}
            <JobCardComplete bookingId={openBookingId} size="full" />
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={handleOut}
              disabled={isPending}
              className="h-12 w-full text-sm"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {isPending
                ? "Clocking out…"
                : "Just stop my clock — job stays open"}
            </Button>
            <Link
              href={`/field/jobs/${openBookingId}`}
              className="text-center text-xs font-medium text-muted-foreground underline underline-offset-2"
            >
              Open job for photos &amp; checklist
            </Link>
          </div>
        ) : isClockedIn ? (
          <Button
            type="button"
            size="lg"
            variant="destructive"
            onClick={handleOut}
            disabled={isPending}
            className="h-14 w-full text-base font-semibold"
          >
            <LogOut className="mr-2 h-5 w-5" />
            {isPending ? "Clocking out…" : "Clock out"}
          </Button>
        ) : (
          /* The button answers only for the category path — job punches fire
             from their own buttons above. Disabled until a category is a
             real choice (and "Other" has its few words), because a punch
             with no answer to "for what?" no longer exists. */
          <Button
            type="button"
            size="lg"
            onClick={handleIn}
            disabled={isPending || !readyToClockIn}
            className="h-14 w-full text-base font-semibold"
          >
            <LogIn className="mr-2 h-5 w-5" />
            {isPending
              ? "Clocking in…"
              : category
                ? `Clock in — ${categories.find((c) => c.key === category)?.label ?? category}`
                : "Pick a job or category above"}
          </Button>
        )}
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          We&apos;ll record your location for payroll verification.
        </p>
      </div>
    </div>
  );
}
