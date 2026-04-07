import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Scheduling" };

export default function SchedulingPage() {
  return (
    <PageShell
      title="Scheduling"
      description="Weekly calendar view with drag-to-reassign."
    >
      <ComingSoon phase="Phase 5" />
    </PageShell>
  );
}
