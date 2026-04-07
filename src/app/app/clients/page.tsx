import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <PageShell
      title="Clients"
      description="Customers your team serves."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
