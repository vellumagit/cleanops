import { LandingPage, landingMetadata } from "@/components/landing-page";
import { getLandingPage } from "@/content/landing";

const page = getLandingPage("cleaning-business-software");

export const metadata = landingMetadata(page);

export default function Page() {
  return <LandingPage page={page} />;
}
