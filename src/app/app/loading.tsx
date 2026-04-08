import { SollosLoader } from "@/components/sollos-loader";

/**
 * Shown the first time a signed-in admin hits /app — the Big Moment we
 * rehearsed the loader for. Also shown whenever the ops console navigates
 * between sections that need fresh server data.
 */
export default function AppLoading() {
  return <SollosLoader tagline="Loading your workspace" />;
}
