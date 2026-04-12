"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock as ClockIcon, LogIn, LogOut, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clockInAction, clockOutAction } from "./actions";

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

function buildFormData(coords: Coords) {
  const fd = new FormData();
  if (coords.lat != null) fd.set("lat", String(coords.lat));
  if (coords.lng != null) fd.set("lng", String(coords.lng));
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

  function handleIn() {
    startTransition(async () => {
      const coords = await getCoords();
      const result = await clockInAction(buildFormData(coords));
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
            <p className="text-sm text-muted-foreground">
              Since{" "}
              {new Date(openSinceIso).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
              {openBookingLabel ? ` · ${openBookingLabel}` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tap below to start your shift.
            </p>
          )}
        </div>
      </div>

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
