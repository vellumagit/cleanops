import { SollosLoader } from "@/components/sollos-loader";

/**
 * Field-app boot splash. Also fires when a cleaner signs in for the
 * first time on a new device and /field is streaming.
 */
export default function FieldLoading() {
  return <SollosLoader tagline="Loading your crew" />;
}
