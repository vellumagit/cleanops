import Link from "next/link";
import { ArrowRight, Calendar, Receipt, CreditCard } from "lucide-react";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatCurrencyCents,
  formatDateTime,
  humanizeEnum,
} from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Your dashboard" };

export default async function ClientDashboardPage() {
  const client = await requireClient();
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(client.organization_id);
  const tz = await getOrgTimezone(client.organization_id);

  const [upcoming, outstanding] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, scheduled_at, service_type, status, address")
      .eq("client_id", client.id)
      .gte("scheduled_at", new Date().toISOString())
      .in("status", ["pending", "confirmed", "en_route", "in_progress"])
      .order("scheduled_at", { ascending: true })
      .limit(3),
    // Pull public_token so the outstanding list can deep-link clients
    // to the pay page directly instead of dumping them on the invoice
    // list where there's nothing to click.
    supabase
      .from("invoices")
      .select("id, number, amount_cents, status, due_date, public_token")
      .eq("client_id", client.id)
      .in("status", ["sent", "overdue", "partially_paid"])
      .order("due_date", { ascending: true })
      .limit(3),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hi, {client.name.split(" ")[0]}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&rsquo;s what&rsquo;s happening with your account.
        </p>
      </div>

      {/* Upcoming jobs */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Calendar className="h-4 w-4 text-violet-500" />
            Upcoming cleans
          </h2>
          <Link
            href="/client/jobs"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            See all →
          </Link>
        </div>
        {(upcoming.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-5 text-center text-sm text-muted-foreground">
            No upcoming cleans scheduled.
          </div>
        ) : (
          <ul className="space-y-2">
            {(upcoming.data ?? []).map((b) => (
              <li key={b.id}>
                <Link
                  href={`/client/jobs`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {humanizeEnum(b.service_type)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(b.scheduled_at, tz)}
                      {b.address ? ` · ${b.address}` : ""}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Outstanding invoices — each row is a direct deep link to the
          pay page (public token → /i/[token] → Stripe or Square hosted
          checkout). The "Pay now" button is the primary CTA; the row
          itself is also clickable for people used to tapping cards. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-emerald-500" />
            Outstanding invoices
          </h2>
          <Link
            href="/client/invoices"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            See all →
          </Link>
        </div>
        {(outstanding.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-5 text-center text-sm text-muted-foreground">
            Nothing to pay right now.
          </div>
        ) : (
          <ul className="space-y-2">
            {(outstanding.data ?? []).map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium tabular-nums">
                    {formatCurrencyCents(inv.amount_cents, currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Invoice {inv.number ?? inv.id.slice(0, 8).toUpperCase()}{" "}
                    · {humanizeEnum(inv.status)}
                    {inv.due_date ? ` · due ${inv.due_date}` : ""}
                  </p>
                </div>
                {inv.public_token ? (
                  <Link
                    href={`/i/${inv.public_token}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    Pay now
                  </Link>
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
