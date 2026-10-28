"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff } from "lucide-react";
import { flushTaps, queuedTapCount } from "./tap";

/**
 * Sends taps the phone couldn't send earlier: on every field screen load,
 * whenever the phone comes back online, and when the app returns to the
 * foreground. Shows a small notice while anything is still waiting, so a
 * cleaner never wonders whether her "I'm here" went through.
 */
export function TapQueueFlusher() {
  const router = useRouter();
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const sent = await flushTaps();
      if (cancelled) return;
      setWaiting(queuedTapCount());
      if (sent > 0) router.refresh();
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (waiting === 0) return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <CloudOff className="h-4 w-4 shrink-0" />
      {waiting === 1
        ? "1 tap saved on your phone — it'll send when you have signal."
        : `${waiting} taps saved on your phone — they'll send when you have signal.`}
    </div>
  );
}
