import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { isTwilioEnabled } from "@/lib/twilio";
import { JobOfferForm } from "./offer-form";

export const metadata = { title: "Send to bench" };

export default async function NewJobOfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id: bookingId } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: booking, error: bErr }, { data: contacts, error: cErr }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, scheduled_at, duration_minutes, service_type, address, total_cents, client:clients ( name )",
        )
        .eq("id", bookingId)
        .maybeSingle(),
      supabase
        .from("freelancer_contacts")
        .select("id, full_name, phone, active")
        .eq("active", true)
        .order("full_name"),
    ]);

  if (bErr) throw bErr;
  if (!booking) notFound();
  if (cErr) throw cErr;

  // If there are zero active freelancers, push the admin to the bench page
  // to add some before trying again.
  if (!contacts || contacts.length === 0) {
    redirect("/app/freelancers");
  }

  return (
    <PageShell
      title="Send to bench"
      description={`Broadcast this shift to your freelancer bench via SMS.`}
      actions={
        <Link
          href={`/app/bookings/${booking.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to booking
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-border bg-card p-6">
          <JobOfferForm
            bookingId={booking.id}
            contacts={contacts.map((c) => ({
              id: c.id,
              full_name: c.full_name,
              phone: c.phone,
            }))}
            booking={{
              scheduled_at: booking.scheduled_at,
              duration_minutes: booking.duration_minutes,
              service_type: booking.service_type,
              address: booking.address,
            }}
          />
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Shift summary</p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Service</dt>
                <dd className="font-medium text-foreground">
                  {humanizeEnum(booking.service_type)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">When</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTime(booking.scheduled_at)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="font-medium text-foreground">
                  {formatDurationMinutes(booking.duration_minutes)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="truncate font-medium text-foreground">
                  {booking.client?.name ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          {!isTwilioEnabled() && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Twilio is disabled.</p>
              <p className="mt-1">
                No SMS will be sent. Dispatch rows will be marked{" "}
                <code className="font-mono text-[11px]">skipped_disabled</code>{" "}
                and you can preview the claim flow by clicking the generated
                links on the offer detail page.
              </p>
            </div>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
