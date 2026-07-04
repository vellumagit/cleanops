"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startJobAction, completeJobAction } from "../actions";

type Coords = { lat: number | null; lng: number | null };

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

function buildFormData(bookingId: string, coords: Coords) {
  const fd = new FormData();
  fd.set("booking_id", bookingId);
  if (coords.lat != null) fd.set("lat", String(coords.lat));
  if (coords.lng != null) fd.set("lng", String(coords.lng));
  return fd;
}

export function JobActionButtons({
  bookingId,
  status,
  youCompleted = false,
}: {
  bookingId: string;
  status: string;
  /** This cleaner finished their own segment of a split shift, but the booking
   *  isn't fully complete yet (later segments are still outstanding). */
  youCompleted?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isStarted = status === "in_progress";
  const isDone = status === "completed";

  function handleStart() {
    startTransition(async () => {
      const coords = await getCoords();
      const result = await startJobAction(buildFormData(bookingId, coords));
      if (result.ok) {
        toast.success("Job started — clocked in");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleComplete() {
    startTransition(async () => {
      const coords = await getCoords();
      const result = await completeJobAction(
        buildFormData(bookingId, coords),
      );
      if (result.ok) {
        toast.success("Job complete — clocked out");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (isDone) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-base font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="h-5 w-5" />
        Job complete. Nice work.
      </div>
    );
  }

  // Split shift: this cleaner finished their segment, but the job stays open
  // for the later crew — don't offer Complete again (it's already recorded).
  if (youCompleted) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center text-base font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        Your part is done — the job stays open until the rest of the crew
        finishes.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!isStarted ? (
        <Button
          type="button"
          size="lg"
          className="h-14 text-base font-semibold"
          onClick={handleStart}
          disabled={isPending}
        >
          <Play className="mr-2 h-5 w-5" />
          {isPending ? "Starting…" : "Start job"}
        </Button>
      ) : null}
      {isStarted ? (
        <Button
          type="button"
          size="lg"
          className="h-14 text-base font-semibold"
          variant="default"
          onClick={handleComplete}
          disabled={isPending}
        >
          <CheckCircle2 className="mr-2 h-5 w-5" />
          {isPending ? "Completing…" : "Complete job"}
        </Button>
      ) : null}
    </div>
  );
}
