import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Employees" };

export default function EmployeesPage() {
  return (
    <PageShell
      title="Employees"
      description="Cleaners, team leads, and admins on your team."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
