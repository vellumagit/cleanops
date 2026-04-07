import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Estimates" };

export default function EstimatesPage() {
  return (
    <PageShell
      title="Estimates"
      description="Quotes sent to clients before they become bookings."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
