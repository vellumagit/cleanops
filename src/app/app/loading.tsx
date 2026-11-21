import { BootSplashOr } from "@/components/boot-splash";
import { SectionLoading } from "@/components/section-loading";

/**
 * The first time a signed-in admin hits /app — the Big Moment we rehearsed
 * the loader for — this is the full-screen splash. Every visit to the
 * dashboard after that, from inside the app, gets the in-shell skeleton
 * instead: the splash covered the sidebar and read as a restart
 * (src/components/boot-splash.tsx).
 *
 * Only the dashboard falls back to this file now: every section has its
 * own loading.tsx.
 */
export default function AppLoading() {
  return (
    <BootSplashOr tagline="Loading your workspace">
      <SectionLoading title="Dashboard" />
    </BootSplashOr>
  );
}
