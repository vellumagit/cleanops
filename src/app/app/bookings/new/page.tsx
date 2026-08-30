import { requireMembership } from "@/lib/auth";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
    estimate_id?: string;
  }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const options = await fetchBookingFormOptions();
  const currency = await getOrgCurrency(membership.organization_id);
  const tz = await getOrgTimezone(membership.organization_id);
  const params = await searchParams;

  // "Create booking" on a portal request should arrive with everything
  // the client already told us — their date, address, and notes. These
  // are starting values, not decisions: the owner still confirms all of
  // it before saving, same as the migration comment promised.
  let fromRequest: {
    client_id?: string;
    address?: string;
    scheduled_at_local?: string;
    notes?: string;
    service_type_id?: string;
    id?: string;
  } = {};
  if (params.from_request) {
    const supabase = await createSupabaseServerClient();
    const { data: reqRow } = (await supabase
      .from("booking_requests" as never)
      .select(
        "client_id, service_type, preferred_date, preferred_time_window, address, notes",
      )
      .eq("id" as never, params.from_request as never)
      .eq("organization_id" as never, membership.organization_id as never)
      .maybeSingle()) as unknown as {
      data: {
        client_id: string;
        service_type: string | null;
        preferred_date: string | null;
        preferred_time_window: string | null;
        address: string | null;
        notes: string | null;
      } | null;
    };
    if (reqRow) {
      // The window is a range, not a time — seed a plausible start and
      // repeat the window in the notes so the owner knows 9:00 is a guess.
      const windowStart: Record<string, string> = {
        morning: "09:00",
        afternoon: "13:00",
        evening: "17:00",
      };
      // The portal's "what do you need cleaned?" is free text, so it can
      // only best-effort match a configured service. The raw text always
      // survives in the notes; a miss just leaves the default service.
      const svcText = (reqRow.service_type ?? "").trim();
      const svcLower = svcText.toLowerCase();
      const matched =
        options.services.find((s) => s.label.toLowerCase() === svcLower) ??
        options.services.find(
          (s) =>
            svcLower.length >= 4 &&
            (svcLower.includes(s.label.toLowerCase()) ||
              s.label.toLowerCase().includes(svcLower)),
        );
      const noteLines = [
        svcText ? `Client asked for: ${svcText}` : null,
        reqRow.preferred_time_window &&
        reqRow.preferred_time_window !== "flexible"
          ? `Preferred time: ${reqRow.preferred_time_window}`
          : null,
        reqRow.notes?.trim() || null,
      ].filter(Boolean) as string[];
      fromRequest = {
        id: params.from_request,
        client_id: reqRow.client_id,
        address: reqRow.address?.trim() || undefined,
        scheduled_at_local: reqRow.preferred_date
          ? `${reqRow.preferred_date}T${
              windowStart[reqRow.preferred_time_window ?? ""] ?? "09:00"
            }`
          : undefined,
        notes: noteLines.length ? noteLines.join("\n") : undefined,
        service_type_id: matched?.id,
      };
    }
  }
  // "Book this job" from an estimate: the client and the agreed price are
  // decisions already made — carry them, plus the description as notes,
  // and stamp the link so the estimate shows "converted".
  let fromEstimate: {
    id?: string;
    client_id?: string;
    total_dollars?: string;
    notes?: string;
  } = {};
  if (params.estimate_id) {
    const supabase = await createSupabaseServerClient();
    const { data: est } = (await supabase
      .from("estimates")
      .select("id, client_id, total_cents, service_description")
      .eq("id", params.estimate_id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        client_id: string;
        total_cents: number;
        service_description: string | null;
      } | null;
    };
    if (est) {
      fromEstimate = {
        id: est.id,
        client_id: est.client_id,
        total_dollars: (est.total_cents / 100).toFixed(2),
        notes: est.service_description?.trim()
          ? `From estimate: ${est.service_description.trim()}`
          : undefined,
      };
    }
  }

  const effectiveClientId =
    params.client_id ?? fromRequest.client_id ?? fromEstimate.client_id;

  // Pre-fill from query params so click-empty-slot on the Dispatch
  // scheduler (and future deep links) lands on a half-filled form.
  // Any field can still be overridden by the user before saving.
  // A preselected client should arrive with their address already filled.
  // The form's client-change handler does this on a live pick, but it never
  // fires for a client set via defaults — so "+Book" from a client's page
  // landed on a form that knew the client and blanked the address anyway.
  // Same precedence as the live handler: a single property's address wins,
  // then the client's own.
  let prefillAddress: string | undefined;
  if (effectiveClientId) {
    const supabase = await createSupabaseServerClient();
    const [{ data: client }, { data: props }] = await Promise.all([
      supabase
        .from("clients")
        .select("address")
        .eq("id", effectiveClientId)
        .maybeSingle() as unknown as Promise<{
        data: { address: string | null } | null;
      }>,
      supabase
        .from("client_properties" as never)
        .select("address")
        .eq("client_id" as never, effectiveClientId as never) as unknown as Promise<{
        data: Array<{ address: string | null }> | null;
      }>,
    ]);
    const propRows = props ?? [];
    prefillAddress =
      (propRows.length === 1 ? propRows[0].address : null) ??
      client?.address ??
      undefined;
  }

  // Their usual job, as starting values. A client on their fifteenth
  // identical 3-hour clean shouldn't need the service re-picked and the
  // price retyped — the last booking already knows all three. Explicit
  // sources (request, estimate) win; this only fills what's still empty.
  let lastJob: {
    service_type_id?: string;
    duration_minutes?: number;
    total_dollars?: string;
  } = {};
  if (effectiveClientId && !fromRequest.id && !fromEstimate.id) {
    const supabase = await createSupabaseServerClient();
    const { data: prev } = (await supabase
      .from("bookings")
      .select("service_type_id, duration_minutes, total_cents")
      .eq("client_id", effectiveClientId)
      .eq("organization_id", membership.organization_id)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as {
      data: {
        service_type_id: string | null;
        duration_minutes: number | null;
        total_cents: number | null;
      } | null;
    };
    if (prev) {
      lastJob = {
        service_type_id: prev.service_type_id ?? undefined,
        duration_minutes: prev.duration_minutes ?? undefined,
        total_dollars:
          prev.total_cents != null
            ? (prev.total_cents / 100).toFixed(2)
            : undefined,
      };
    }
  }

  const defaults: BookingFormDefaults = {
    client_id: effectiveClientId,
    assigned_to: params.assigned_to,
    // The address the client typed on THIS request beats their saved one.
    address: fromRequest.address ?? prefillAddress,
    notes: fromRequest.notes ?? fromEstimate.notes,
    service_type_id: fromRequest.service_type_id ?? lastJob.service_type_id,
    duration_minutes: lastJob.duration_minutes,
    total_dollars: fromEstimate.total_dollars ?? lastJob.total_dollars,
    from_request: fromRequest.id,
    estimate_id: fromEstimate.id,
    scheduled_at_local: params.scheduled_at
      ? isoToDatetimeLocal(params.scheduled_at, tz)
      : fromRequest.scheduled_at_local,
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
