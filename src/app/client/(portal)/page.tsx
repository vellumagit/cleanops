import Link from "next/link";
import { ArrowRight, Calendar, Receipt, CreditCard } from "lucide-react";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatCurrencyCents,
  formatDate,
  formatDateTime,
  humanizeEnum,
} from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Your cleans" };

export default async function ClientDashboardPage() {
  const client = await requireClient();
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(client.organization_id);
  const tz = await getOrgTimezone(client.organization_id);

  const [upcoming, outstanding] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, service_type, service_type_label, status, address",
      )
      .eq("client_id", client.id)
      .gte("scheduled_at", new Date().toISOString())
      // Pending deliberately excluded: it means the office has penciled the
      // job in but not committed to it (an estimate placeholder, a duplicate
      // awaiting a real date). A client should not see, or plan around, a job
      // nobody has confirmed — it appears here the moment it is confirmed.
      .in("status", ["confirmed", "en_route", "in_progress"])
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
        <p className="mt-1 text-base text-muted-foreground">
          Your next cleans, and anything there is to pay.
        </p>
      </div>

      {/* Reviews are pull-first: asking is rare (org-configured cadence),
          volunteering is always one tap away on any finished visit. */}
      <section className="rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-base">
          <span className="font-medium">Want to tell us how we did?</span>{" "}
          <span className="text-muted-foreground">
            Every finished visit in{" "}
            <Link
              href="/client/jobs"
              className="underline underline-offset-2 hover:text-foreground"
            >
              your cleans
            </Link>{" "}
            has a link to leave a review, whenever you like.
          </span>
        </p>
      </section>

      {/* Upcoming jobs */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Calendar className="h-4 w-4 text-violet-500" />
            Upcoming cleans
          </h2>
          <Link
            href="/client/jobs"
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground active:text-foreground active:underline"
          >
            See all →
          </Link>
        </div>
        {(upcoming.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-5 text-center text-base text-muted-foreground">
            No cleans are booked right now.{" "}
            <Link href="/client/request" className="font-medium text-foreground underline underline-offset-4">
              Ask for one
            </Link>
            .
          </div>
        ) : (
          <ul className="space-y-2">
            {(upcoming.data ?? []).map((b) => (
              <li key={b.id}>
                <Link
                  // The row IS one specific visit — it goes to that visit, not
                  // the list. The template literal was already here with its
                  // interpolation missing: the fossil of this link meaning to
                  // be dynamic, caught by Brian clicking it on his phone.
                  href={`/client/jobs/${b.id}`}
                  className="tap-row flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:border-foreground/30"
                >
                  <div className="min-w-0 flex-1">
                    {/* When first: it is the thing a client is looking for. */}
                    <p className="text-base font-semibold">{formatDateTime(b.scheduled_at, tz)}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {b.service_type_label ?? humanizeEnum(b.service_type)}
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
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Receipt className="h-4 w-4 text-emerald-500" />
            To pay
          </h2>
          <Link
            href="/client/invoices"
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground active:text-foreground active:underline"
          >
            See all →
          </Link>
        </div>
        {(outstanding.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-5 text-center text-base text-muted-foreground">
            Nothing to pay right now.
          </div>
        ) : (
          <ul className="space-y-2">
            {(outstanding.data ?? []).map((inv) => (
              <li
                key={inv.id}
                className="tap-row flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:border-foreground/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold tabular-nums">
                    {formatCurrencyCents(inv.amount_cents, currency)}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Invoice {inv.number ?? inv.id.slice(0, 8).toUpperCase()}
                    {inv.status === "overdue" ? " · overdue" : inv.status === "partially_paid" ? " · part paid" : ""}
                    {inv.due_date ? ` · due ${formatDate(inv.due_date, tz)}` : ""}
                  </p>
                </div>
                {inv.public_token ? (
                  <Link
                    href={`/i/${inv.public_token}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-all hover:opacity-90 active:scale-95 active:opacity-80"
                  >
                    <CreditCard className="h-4 w-4" />
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
