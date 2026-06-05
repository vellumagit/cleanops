import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { EstimateForm } from "../../estimate-form";
import { DeleteEstimateForm } from "./delete-form";
import { SendEstimateForm } from "./send-form";
import { PublicLinkActions } from "./public-link-actions";
import { DownloadPdfButton } from "./download-pdf-button";

export const metadata = { title: "Edit estimate" };

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const [{ data: estimate, error }, { data: clients }, { data: linkedBooking }] =
    await Promise.all([
      supabase
        .from("estimates")
        .select(
          "id, client_id, service_description, notes, status, total_cents, pdf_url, client_email_sent_at, public_token",
        )
        .eq("id", id)
        .maybeSingle() as unknown as {
        data: {
          id: string;
          client_id: string;
          service_description: string | null;
          notes: string | null;
          status: string;
          total_cents: number;
          pdf_url: string | null;
          client_email_sent_at: string | null;
          public_token: string | null;
        } | null;
        error: unknown;
      },
      supabase
        .from("clients")
        .select("id, name, email")
        .order("name") as unknown as {
        data: Array<{ id: string; name: string; email: string | null }> | null;
      },
      supabase
        .from("bookings")
        .select("id, status, scheduled_at")
        .eq("estimate_id" as never, id as never)
        .limit(1)
        .maybeSingle() as unknown as {
        data: { id: string; status: string; scheduled_at: string } | null;
      },
    ]);

  if (error) throw error;
  if (!estimate) notFound();

  // Public shareable URL for the branded estimate page. The customer
  // can view it without logging in; the owner uses this same page to
  // print → save as PDF (the public estimate template has a "Print /
  // Save PDF" button in the top-right that's hidden on print).
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const publicUrl = estimate.public_token
    ? `${siteUrl}/e/${estimate.public_token}`
    : null;

  return (
    <PageShell title="Edit estimate">
      <div className="max-w-2xl space-y-6">
        {linkedBooking && (
          <Link
            href={`/app/bookings/${linkedBooking.id}`}
            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <ArrowRight className="h-4 w-4" />
            <span>
              This estimate was converted to a{" "}
              <span className="font-semibold">{linkedBooking.status}</span>{" "}
              booking.{" "}
              <span className="underline underline-offset-2">View booking →</span>
            </span>
          </Link>
        )}

        <div className="rounded-lg border border-border bg-card p-6">
          <EstimateForm
            key={estimate.status}
            mode="edit"
            id={estimate.id}
            currency={currency}
            clients={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
            defaults={{
              client_id: estimate.client_id,
              service_description: estimate.service_description,
              notes: estimate.notes,
              status: estimate.status,
              total_dollars: centsToDollarString(estimate.total_cents),
              pdf_url: estimate.pdf_url,
            }}
          />
        </div>

        {/* Public link + PDF actions. The Download PDF button generates
            a real .pdf file server-side (Puppeteer renders the branded
            /e/[token] page and streams it back inline). View / Copy
            link still open the web version for share-via-link cases. */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold text-foreground">
            Share &amp; PDF
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Download a branded PDF copy or grab the link to the public
            customer-facing version. The PDF is the same layout your
            customer sees when they open the link.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DownloadPdfButton
              estimateId={estimate.id}
              initialToken={estimate.public_token}
            />
            {publicUrl && <PublicLinkActions url={publicUrl} />}
          </div>
        </div>

        <SendEstimateForm
          estimateId={estimate.id}
          clientHasEmail={Boolean(
            (clients ?? []).find((c) => c.id === estimate.client_id)?.email,
          )}
          lastSentAt={estimate.client_email_sent_at}
        />

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will cascade to all line items on this estimate.
          </p>
          <div className="mt-4">
            <DeleteEstimateForm id={estimate.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
