import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { EstimateForm } from "../../estimate-form";
import { DeleteEstimateForm } from "./delete-form";

export const metadata = { title: "Edit estimate" };

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: estimate, error }, { data: clients }, { data: linkedBooking }] =
    await Promise.all([
      supabase
        .from("estimates")
        .select(
          "id, client_id, service_description, notes, status, total_cents, pdf_url",
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
        } | null;
        error: unknown;
      },
      supabase.from("clients").select("id, name").order("name"),
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
            mode="edit"
            id={estimate.id}
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
