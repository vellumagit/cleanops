"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SollosLoader } from "@/components/sollos-loader";

declare global {
  interface Window {
    /** Set once an app shell (/app or /field) has mounted in this tab. */
    __sollosShellMounted?: boolean;
  }
}

/**
 * Marks this tab's app shell as up. Rendered once by the /app and /field
 * layouts; shows nothing.
 */
export function ShellMountedMark() {
  useEffect(() => {
    window.__sollosShellMounted = true;
  }, []);
  return null;
}

/**
 * The boot splash on a cold start, the in-shell skeleton (children) on
 * every navigation after it.
 *
 * /app/loading.tsx and /field/loading.tsx used to be the full-screen
 * SollosLoader outright (fixed, inset 0, z-index 100, black). Fine as the
 * first thing a person sees; on an ordinary click back to the dashboard it
 * blacked out the sidebar and tab bar for the length of a round trip and
 * read as the app restarting. That is the polish problem src/components/
 * skeleton.tsx already describes for the sections.
 *
 * How the two cases are told apart: on a cold load this renders on the
 * server, and again in hydration before any effect has run, so the flag is
 * unset both times and the splash matches. On a later navigation the
 * fallback mounts in a tab whose shell has already set the flag.
 */
export function BootSplashOr({
  tagline,
  children,
}: {
  tagline: string;
  children: ReactNode;
}) {
  const [cold] = useState(
    () => typeof window === "undefined" || !window.__sollosShellMounted,
  );
  return cold ? <SollosLoader tagline={tagline} /> : <>{children}</>;
}
