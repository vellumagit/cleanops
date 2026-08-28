"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Tells a stale tab it's stale — before it eats a click.
 *
 * Brian, after a Save reverted: "the whole page reloads really quickly,
 * and then it shows the state it was before." That quick reload is
 * Next.js recovering from a server-action ID the current deployment no
 * longer knows — every open tab goes stale the moment a deploy lands,
 * and this app deploys many times a day. The beacon compares the bundle's
 * baked build sha against the running deployment (on focus + every 5
 * minutes) and raises one persistent toast offering a reload, so "your
 * app updated" is said out loud instead of expressed as a swallowed save.
 */
export function UpdateBeacon() {
  const announced = useRef(false);

  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_SHA;
    if (!mine || mine === "dev") return;

    let cancelled = false;
    async function check() {
      if (cancelled || announced.current) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { sha } = (await res.json()) as { sha?: string };
        if (!sha || sha === "dev" || sha === mine) return;
        announced.current = true;
        toast.info("Sollos was updated", {
          description:
            "This tab is running an older version — saving may not work until you reload.",
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: () => window.location.reload(),
          },
        });
      } catch {
        // Offline / transient — try again next cycle.
      }
    }

    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(check, 5 * 60 * 1000);
    void check();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, []);

  return null;
}
