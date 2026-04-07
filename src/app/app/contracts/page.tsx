import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Contracts" };

export default function ContractsPage() {
  return (
    <PageShell
      title="Contracts"
      description="Active and past service agreements with clients."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
