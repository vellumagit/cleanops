import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  // Pull counts for every major entity in parallel. Each of these hits the DB
  // with an RLS-aware head query so it's cheap.
  const tables = [
    "clients",
    "bookings",
    "estimates",
    "contracts",
    "invoices",
    "reviews",
    "packages",
    "training_modules",
    "inventory_items",
    "memberships",
  ] as const;

  const counts = await Promise.all(
    tables.map(async (t) => {
      const { count } = await supabase
        .from(t)
        .select("id", { count: "exact", head: true });
      return { table: t, count: count ?? 0 };
    }),
  );

  const countMap = Object.fromEntries(counts.map((c) => [c.table, c.count]));

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back to {membership.organization_name}.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={countMap.clients} />
        <StatCard label="Bookings" value={countMap.bookings} />
        <StatCard label="Open estimates" value={countMap.estimates} />
        <StatCard label="Invoices" value={countMap.invoices} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Employees" value={countMap.memberships} />
        <StatCard label="Packages" value={countMap.packages} />
        <StatCard label="Contracts" value={countMap.contracts} />
        <StatCard label="Reviews" value={countMap.reviews} />
        <StatCard label="Training modules" value={countMap.training_modules} />
        <StatCard label="Inventory items" value={countMap.inventory_items} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Phase 3b is live</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Every sidebar link now points to a real, RLS-aware list page
            backed by the seeded data &mdash; clients, bookings, estimates,
            contracts, invoices, employees, packages, inventory, reviews, and
            training. Each table is fully searchable client-side.
          </p>
          <p className="mt-2">
            Phase 3c will rebuild this dashboard itself: hero metric cards
            with deltas, today&rsquo;s jobs, week summary, top performers, and
            an activity feed. After that, Phase 4 brings full CRUD on each
            entity through the ops console.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
