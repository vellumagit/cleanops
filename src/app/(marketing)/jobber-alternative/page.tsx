import { ComparePage } from "@/components/compare-page";
import { landingMetadata } from "@/components/landing-page";
import { getComparePage } from "@/content/compare";

const page = getComparePage("jobber-alternative");

export const metadata = landingMetadata(page);

export default function Page() {
  return <ComparePage page={page} />;
}
