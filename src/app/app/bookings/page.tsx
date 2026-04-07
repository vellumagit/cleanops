import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Bookings" };

export default function BookingsPage() {
  return (
    <PageShell
      title="Bookings"
      description="All cleaning jobs scheduled across your team."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
