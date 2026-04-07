import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Training" };

export default function TrainingPage() {
  return (
    <PageShell
      title="Training"
      description="Modules and progress tracking for your team."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
