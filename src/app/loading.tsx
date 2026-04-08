import { SollosLoader } from "@/components/sollos-loader";

/**
 * Root-level streaming fallback. Shown when navigating to any top-level
 * segment that is still resolving its server data.
 */
export default function RootLoading() {
  return <SollosLoader />;
}
