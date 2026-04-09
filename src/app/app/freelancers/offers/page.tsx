import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDateTime, humanizeEnum } from "@/lib/format";

export const metadata = { title: "Job offers" };

type OfferStatus = "open" | "filled" | "cancelled" | "expired";

function offerTone(status: OfferStatus): StatusTone {
  switch (status) {
    case "open":
      return "blue";
    case "filled":
      return "green";
    case "cancelled":
      return "red";
    case "expired":
      return "amber";
  }
}

export default async function JobOffersPage() {
  await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("job_offers")
    .select(
      `
        id,
        status,
        pay_cents,
        created_at,
        expires_at,
        filled_at,
        booking:bookings ( id, scheduled_at, service_type, address ),
        dispatches:job_offer_dispatches ( id, delivery_status )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const rows = data ?? [];

  return (
    <PageShell
      title="Job offers"
      description="Every shift you have broadcast to the freelancer bench."
    >
      {rows.length === 0 ? (
        <div className="sollos-card flex flex-col items-center justify-center border-dashed px-6 py-20 text-center">
          <p className="text-sm font-semibold">No offers yet</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Open any booking and use the &ldquo;Send to bench&rdquo; button to
            broadcast it to your freelancers.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Shift</th>
                <th className="px-4 py-2 text-left font-medium">When</th>
                <th className="px-4 py-2 text-right font-medium">Pay</th>
                <th className="px-4 py-2 text-right font-medium">Dispatches</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const status = o.status as OfferStatus;
                const dispatchCount = o.dispatches?.length ?? 0;
                return (
                  <tr
                    key={o.id}
                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/20"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/app/freelancers/offers/${o.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {humanizeEnum(o.booking?.service_type ?? null)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatDateTime(o.booking?.scheduled_at ?? null)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {formatCurrencyCents(o.pay_cents)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {dispatchCount}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDateTime(o.created_at)}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={offerTone(status)}>
                        {humanizeEnum(status)}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
