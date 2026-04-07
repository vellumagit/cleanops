import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Packages" };

export default function PackagesPage() {
  return (
    <PageShell
      title="Packages"
      description="Reusable service packages you offer to clients."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
