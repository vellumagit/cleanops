import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Reviews" };

export default function ReviewsPage() {
  return (
    <PageShell
      title="Reviews"
      description="Client feedback after each completed job."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
