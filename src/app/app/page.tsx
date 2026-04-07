import { requireMembership } from "@/lib/auth";

export default async function AppHome() {
  const membership = await requireMembership();

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Welcome to {membership.organization_name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Phase 1 spine is live. Auth, multi-tenancy, and RLS are wired up.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your role
          </p>
          <p className="mt-1 text-2xl font-semibold">{membership.role}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Organization
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {membership.organization_name}
          </p>
        </div>
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        Phase 2 next: domain schema (clients, bookings, employees, packages,
        invoices, etc).
      </p>
    </div>
  );
}
