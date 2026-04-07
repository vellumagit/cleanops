import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Invoices" };

export default function InvoicesPage() {
  return (
    <PageShell
      title="Invoices"
      description="Bills sent to clients. Auto-generatable from completed bookings."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
