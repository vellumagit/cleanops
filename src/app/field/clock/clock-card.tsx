"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock as ClockIcon, LogIn, LogOut, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clockInAction, clockOutAction } from "./actions";

type Coords = { lat: number | null; lng: number | null };

// Categories for an off-job clock-in (not tied to a booking). Start a job from
// its page to log cleaning time instead.
const WORK_CATEGORIES = [
  { key: "manager", label: "Manager / admin" },
  { key: "training", label: "Training" },
  { key: "travel", label: "Travel" },
  { key: "supplies", label: "Supplies / errand" },
  { key: "other", label: "Other" },
];

/** "3h 12m" / "47m" — the number a person needs to notice something is wrong. */
function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Live elapsed time since clock-in, ticking every 30s.
 *
 * The card used to read "Since 8:04 AM" — no date, no duration. Someone
 * opening the app on Thursday saw what looked like this morning and tapped
 * Clock out, which is exactly how a 68-hour shift gets recorded. A running
 * total makes a stale shift impossible to misread.
 *
 * Starts null and fills in on mount: computing a duration during render is
 * both impure and a hydration mismatch waiting to happen.
 */
function useElapsed(sinceIso: string | null): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  useEffect(() => {
    if (!sinceIso) return;
    const started = new Date(sinceIso).getTime();
    const tick = () => setElapsedMs(Date.now() - started);
    // First tick on a timeout rather than inline: setting state synchronously
    // inside an effect forces a second render pass before paint, which is
    // what react-hooks/set-state-in-effect exists to prevent. A 0ms defer
    // lands in the same frame visually.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [sinceIso]);
  // Derived, not stored: when the shift ends the prop goes null and the stale
  // elapsed value must not linger. Cheaper than another state write.
  return sinceIso ? elapsedMs : null;
}

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
      (pos) =>
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}

function buildFormData(coords: Coords, category?: string) {
  const fd = new FormData();
  if (coords.lat != null) fd.set("lat", String(coords.lat));
  if (coords.lng != null) fd.set("lng", String(coords.lng));
  if (category) fd.set("work_category", category);
  return fd;
}

export function ClockCard({
  isClockedIn,
  openSinceIso,
  openBookingLabel,
}: {
  isClockedIn: boolean;
  openSinceIso: string | null;
  openBookingLabel: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState("manager");

  const elapsedMs = useElapsed(isClockedIn ? openSinceIso : null);
  useAppBadge(elapsedMs == null ? null : Math.floor(elapsedMs / 3_600_000));
  // Past this the shift is almost certainly a forgotten clock-out rather than
  // a long day — say so on the card instead of waiting for the nightly cap.
  const looksStale = elapsedMs != null && elapsedMs > 10 * 3_600_000;

  function handleIn() {
    startTransition(async () => {
      const coords = await getCoords();
      const result = await clockInAction(buildFormData(coords, category));
      if (result.ok) {
        toast.success("Clocked in");
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
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            What are you working on?{" "}
            <span className="font-normal">
              (for cleaning a job, start it from the job page instead)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {WORK_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={
                  category === c.key
                    ? "rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                    : "rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        {isClockedIn ? (
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
          <Button
            type="button"
            size="lg"
            onClick={handleIn}
            disabled={isPending}
            className="h-14 w-full text-base font-semibold"
          >
            <LogIn className="mr-2 h-5 w-5" />
            {isPending ? "Clocking in…" : "Clock in"}
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
