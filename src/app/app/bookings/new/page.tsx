import { requireMembership } from "@/lib/auth";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { PageShell } from "@/components/page-shell";
import { BookingForm, type BookingFormDefaults } from "../booking-form";
import { fetchBookingFormOptions } from "../options";

export const metadata = { title: "New booking" };

/**
 * Convert a UTC ISO timestamp to a datetime-local string (YYYY-MM-DDTHH:mm)
 * rendered in the given timezone. Used to pre-fill the booking form from
 * click-empty-slot in the scheduler Dispatch view — the user clicked on
 * 2:30pm in Jane's column, we need the form to show 14:30 in their tz.
 */
function isoToDatetimeLocal(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{
    client_id?: string;
    assigned_to?: string;
    scheduled_at?: string;
    from_request?: string;
  }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const options = await fetchBookingFormOptions();
  const currency = await getOrgCurrency(membership.organization_id);
  const tz = await getOrgTimezone(membership.organization_id);
  const params = await searchParams;

  // Pre-fill from query params so click-empty-slot on the Dispatch
  // scheduler (and future deep links) lands on a half-filled form.
  // Any field can still be overridden by the user before saving.
  const defaults: BookingFormDefaults = {
    client_id: params.client_id,
    assigned_to: params.assigned_to,
    scheduled_at_local: params.scheduled_at
      ? isoToDatetimeLocal(params.scheduled_at, tz)
      : undefined,
  };

  return (
    <PageShell title="New booking" description="Schedule a job for your team.">
      <div className="max-w-3xl rounded-lg border border-border bg-card p-6">
        <BookingForm
          mode="create"
          currency={currency}
          defaults={defaults}
          {...options}
        />
      </div>
    </PageShell>
  );
}
