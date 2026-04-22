"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { BookingSchema, RecurringBookingSchema } from "@/lib/validators/bookings";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import { generateOccurrences, type SeriesRule } from "@/lib/recurrence";
import {
  notifyBookingAssignment,
  notifyBookingCancelledToEmployee,
  sendBookingCancelledToClient,
  sendBookingConfirmation,
  sendBookingRescheduled,
} from "@/lib/automations";
import { canCreateData } from "@/lib/subscription";
import { getOrgTimezone } from "@/lib/org-timezone";
import { localInputToUtcIso } from "@/lib/validators/common";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirectAfterSetup } from "@/lib/setup-return";

type Field = keyof typeof BookingSchema.shape;
export type BookingFormState = ActionState<Field & string>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    package_id: String(formData.get("package_id") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    scheduled_at: String(formData.get("scheduled_at") ?? ""),
    duration_minutes: String(formData.get("duration_minutes") ?? ""),
    service_type: String(formData.get("service_type") ?? "standard"),
    status: String(formData.get("status") ?? "pending"),
    total_cents: String(formData.get("total_cents") ?? ""),
    hourly_rate_cents: String(formData.get("hourly_rate_cents") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

function readRecurringFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    package_id: String(formData.get("package_id") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    recurrence_pattern: String(formData.get("recurrence_pattern") ?? "weekly"),
    custom_days: String(formData.get("custom_days") ?? ""),
    monthly_nth: String(formData.get("monthly_nth") ?? ""),
    monthly_dow: String(formData.get("monthly_dow") ?? ""),
    start_time: String(formData.get("start_time") ?? ""),
    starts_at: String(formData.get("starts_at") ?? ""),
    ends_at: String(formData.get("ends_at") ?? ""),
    generate_ahead: String(formData.get("generate_ahead") ?? "8"),
    duration_minutes: String(formData.get("duration_minutes") ?? ""),
    service_type: String(formData.get("service_type") ?? "recurring"),
    total_cents: String(formData.get("total_cents") ?? ""),
    hourly_rate_cents: String(formData.get("hourly_rate_cents") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

/**
 * Look up human-readable names for the client and assigned employee so
 * the Google Calendar event has a useful title/description.
 */
async function getBookingLabels(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  clientId: string,
  assignedTo: string | null,
) {
  let clientName: string | undefined;
  let employeeName: string | undefined;

  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  if (client) clientName = client.name;

  if (assignedTo) {
    const { data: emp } = await supabase
      .from("memberships")
      .select("profiles(full_name)")
      .eq("id", assignedTo)
      .maybeSingle();
    if (emp?.profiles) {
      const profile = emp.profiles as unknown as { full_name: string };
      employeeName = profile.full_name;
    }
  }

  return { clientName, employeeName };
}

export async function createBookingAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(BookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Re-interpret the datetime-local string using the org's timezone.
  // BookingSchema's transform used DEFAULT_TZ (falls back to a reasonable
  // default but can drift for orgs outside Eastern). Rewriting here uses
  // the authoritative per-org timezone.
  const orgTz = await getOrgTimezone(membership.organization_id);
  parsed.data.scheduled_at = localInputToUtcIso(raw.scheduled_at, orgTz);

  // Block "future-intent" bookings (pending/confirmed/en_route) from being
  // created in the past. Back-filling a completed/cancelled job from yesterday
  // is a real use case, so we only reject the statuses that imply the work
  // hasn't happened yet. 24h grace lets someone create a same-day booking
  // without fighting clock-skew.
  const scheduledMs = new Date(parsed.data.scheduled_at).getTime();
  const isFutureIntent = ["pending", "confirmed", "en_route"].includes(
    parsed.data.status,
  );
  if (isFutureIntent && scheduledMs < Date.now() - 24 * 60 * 60 * 1000) {
    return {
      errors: {
        scheduled_at:
          "This booking is in the past. Pick a future date, or set status to Completed if you're back-filling.",
      },
      values: raw,
    };
  }

  if (!(await canCreateData(membership.organization_id))) {
    return { errors: { _form: "Your subscription has expired. Subscribe to create new bookings." }, values: raw };
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      package_id: parsed.data.package_id ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { errors: { _form: error.message }, values: raw };

  // Email booking confirmation to client (fire-and-forget)
  sendBookingConfirmation(booking.id);

  // Notify assigned employee (fire-and-forget)
  if (parsed.data.assigned_to) {
    const labels = await getBookingLabels(supabase, parsed.data.client_id, parsed.data.assigned_to);
    notifyBookingAssignment(
      membership.organization_id,
      booking.id,
      parsed.data.assigned_to,
      {
        clientName: labels.clientName ?? "A client",
        scheduledAt: parsed.data.scheduled_at,
        serviceType: parsed.data.service_type,
        address: parsed.data.address ?? null,
      },
    );
  }

  // Sync to Google Calendar (fire-and-forget — don't block the action)
  const labels = await getBookingLabels(
    supabase,
    parsed.data.client_id,
    parsed.data.assigned_to ?? null,
  );
  createCalendarEvent(membership.organization_id, {
    id: booking.id,
    scheduled_at: parsed.data.scheduled_at,
    duration_minutes: parsed.data.duration_minutes,
    service_type: parsed.data.service_type,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes ?? null,
    client_name: labels.clientName,
    employee_name: labels.employeeName,
  }).catch((err) => console.error("[gcal] sync error on create:", err));

  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirectAfterSetup(formData, "/app/bookings");
}

export async function createRecurringBookingAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readRecurringFormValues(formData);
  const parsed = parseForm(RecurringBookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors as BookingFormState["errors"], values: raw };

  const { membership, supabase } = await getActionContext();

  const orgTz = await getOrgTimezone(membership.organization_id);

  // Reject series that start in the past. Unlike single bookings, a
  // recurring series starting yesterday has no legitimate interpretation —
  // you'd just generate a bunch of past occurrences nobody wanted. A 1-day
  // grace covers clock-skew on same-day creation.
  const startsDate = new Date(parsed.data.starts_at);
  if (
    Number.isFinite(startsDate.getTime()) &&
    startsDate.getTime() < Date.now() - 24 * 60 * 60 * 1000
  ) {
    return {
      errors: {
        _form:
          "The start date is in the past. Pick today or a future date — we don't generate past occurrences.",
      },
      values: raw,
    };
  }

  // Validate custom_days for custom_weekly
  if (
    parsed.data.recurrence_pattern === "custom_weekly" &&
    (!parsed.data.custom_days || parsed.data.custom_days.length === 0)
  ) {
    return {
      errors: { _form: "Select at least one day of the week for custom weekly scheduling." },
      values: raw,
    };
  }

  // Validate monthly_nth inputs
  if (
    parsed.data.recurrence_pattern === "monthly_nth" &&
    (parsed.data.monthly_nth == null || parsed.data.monthly_dow == null)
  ) {
    return {
      errors: { _form: "Pick both an ordinal (1st, 2nd, etc.) and a weekday for monthly scheduling." },
      values: raw,
    };
  }

  // 1. Create the booking series
  const { data: series, error: seriesErr } = await (supabase
    .from("booking_series" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      pattern: parsed.data.recurrence_pattern,
      custom_days: parsed.data.recurrence_pattern === "custom_weekly"
        ? parsed.data.custom_days
        : null,
      monthly_nth: parsed.data.recurrence_pattern === "monthly_nth"
        ? parsed.data.monthly_nth ?? null
        : null,
      monthly_dow: parsed.data.recurrence_pattern === "monthly_nth"
        ? parsed.data.monthly_dow ?? null
        : null,
      start_time: parsed.data.start_time,
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at ?? null,
      generate_ahead: parsed.data.generate_ahead,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      package_id: parsed.data.package_id ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    } as never)
    .select("id")
    .single() as unknown as { data: { id: string } | null; error: { message: string } | null });

  if (seriesErr || !series) {
    return {
      errors: { _form: seriesErr?.message ?? "Failed to create series" },
      values: raw,
    };
  }

  // 2. Generate the first batch of occurrences
  const rule: SeriesRule = {
    pattern: parsed.data.recurrence_pattern,
    custom_days: parsed.data.custom_days ?? null,
    start_time: parsed.data.start_time,
    starts_at: parsed.data.starts_at,
    ends_at: parsed.data.ends_at ?? null,
    generate_ahead: parsed.data.generate_ahead,
    monthly_nth: parsed.data.monthly_nth ?? null,
    monthly_dow: parsed.data.monthly_dow ?? null,
    tz: orgTz,
  };

  const occurrences = generateOccurrences(rule, parsed.data.generate_ahead, null);

  if (occurrences.length === 0) {
    return {
      errors: { _form: "No occurrences could be generated from the recurrence rule. Check your start date and days." },
      values: raw,
    };
  }

  // 3. Insert all booking instances
  const bookingRows = occurrences.map((scheduled_at) => ({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    package_id: parsed.data.package_id ?? null,
    assigned_to: parsed.data.assigned_to ?? null,
    scheduled_at,
    duration_minutes: parsed.data.duration_minutes,
    service_type: parsed.data.service_type,
    status: "confirmed" as const,
    total_cents: parsed.data.total_cents,
    hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
    address: parsed.data.address ?? null,
    notes: parsed.data.notes
      ? `[Recurring] ${parsed.data.notes}`
      : "[Recurring]",
    series_id: series.id,
  }));

  const { data: insertedBookings, error: bookingsErr } = await (supabase
    .from("bookings")
    .insert(bookingRows as never)
    .select("id, scheduled_at") as unknown as {
    data: { id: string; scheduled_at: string }[] | null;
    error: { message: string } | null;
  });

  if (bookingsErr) {
    return {
      errors: { _form: bookingsErr.message },
      values: raw,
    };
  }

  // 4. Sync each to Google Calendar (fire-and-forget)
  if (insertedBookings && insertedBookings.length > 0) {
    const labels = await getBookingLabels(
      supabase,
      parsed.data.client_id,
      parsed.data.assigned_to ?? null,
    );

    for (const b of insertedBookings) {
      createCalendarEvent(membership.organization_id, {
        id: b.id,
        scheduled_at: b.scheduled_at,
        duration_minutes: parsed.data.duration_minutes,
        service_type: parsed.data.service_type,
        address: parsed.data.address ?? null,
        notes: parsed.data.notes ?? null,
        client_name: labels.clientName,
        employee_name: labels.employeeName,
      }).catch((err) => console.error("[gcal] sync error on recurring create:", err));
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/calendar");
  revalidatePath("/app");
  redirectAfterSetup(formData, "/app/bookings");
}

export async function updateBookingAction(
  id: string,
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(BookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Re-interpret datetime-local with the org's tz (see createBookingAction).
  const orgTz = await getOrgTimezone(membership.organization_id);
  parsed.data.scheduled_at = localInputToUtcIso(raw.scheduled_at, orgTz);

  // Fetch the existing booking to detect assignee + scheduled_at + status changes
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id, assigned_to, scheduled_at, status")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      google_calendar_event_id: string | null;
      assigned_to: string | null;
      scheduled_at: string | null;
      status: string | null;
    } | null;
  };

  // If the assignee changed, notify the new employee
  const assigneeChanged =
    parsed.data.assigned_to &&
    parsed.data.assigned_to !== existing?.assigned_to;
  if (assigneeChanged) {
    const labels = await getBookingLabels(supabase, parsed.data.client_id, parsed.data.assigned_to!);
    notifyBookingAssignment(
      membership.organization_id,
      id,
      parsed.data.assigned_to!,
      {
        clientName: labels.clientName ?? "A client",
        scheduledAt: parsed.data.scheduled_at,
        serviceType: parsed.data.service_type,
        address: parsed.data.address ?? null,
      },
    );
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      client_id: parsed.data.client_id,
      package_id: parsed.data.package_id ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      hourly_rate_cents: parsed.data.hourly_rate_cents ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };

  // If the scheduled time changed, email the client + push employee
  // (both handled inside sendBookingRescheduled).
  if (
    existing?.scheduled_at &&
    existing.scheduled_at !== parsed.data.scheduled_at
  ) {
    sendBookingRescheduled(id, existing.scheduled_at);
  }

  // If the status flipped TO cancelled (not already cancelled), push the
  // assigned employee AND email the client.
  if (
    existing?.status !== "cancelled" &&
    parsed.data.status === "cancelled"
  ) {
    notifyBookingCancelledToEmployee(id);
    sendBookingCancelledToClient(id);
  }

  // Sync to Google Calendar
  const labels = await getBookingLabels(
    supabase,
    parsed.data.client_id,
    parsed.data.assigned_to ?? null,
  );

  if (existing?.google_calendar_event_id) {
    // Update existing event
    updateCalendarEvent(membership.organization_id, {
      id,
      google_calendar_event_id: existing.google_calendar_event_id,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      client_name: labels.clientName,
      employee_name: labels.employeeName,
    }).catch((err) => console.error("[gcal] sync error on update:", err));
  } else {
    // No event yet — create one
    createCalendarEvent(membership.organization_id, {
      id,
      scheduled_at: parsed.data.scheduled_at,
      duration_minutes: parsed.data.duration_minutes,
      service_type: parsed.data.service_type,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      client_name: labels.clientName,
      employee_name: labels.employeeName,
    }).catch((err) => console.error("[gcal] sync error on create:", err));
  }

  revalidatePath("/app/bookings");
  revalidatePath(`/app/bookings/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/bookings");
}

export async function deleteBookingAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const cascade = String(formData.get("cascade_series") ?? "") === "true";
  const { membership, supabase } = await getActionContext();

  // Fetch the Google Calendar event ID + series_id before deleting
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id, series_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      google_calendar_event_id: string | null;
      series_id: string | null;
    } | null;
  };

  // Cascade: delete every booking in this series first, then the series row.
  // We already verified the booking belongs to the user's org via the RLS-
  // bound fetch above. Use the admin client for the bulk delete because
  // RLS on bookings can silently drop bulk-DELETE rows when the filter
  // column (series_id) isn't in the policy's predicate shape — we still
  // enforce org isolation via an explicit .eq("organization_id", ...).
  if (cascade && existing?.series_id) {
    const admin = createSupabaseAdminClient();

    // Collect every Google Calendar event id in the series so we can
    // unsync them after the row delete.
    const { data: siblings } = (await admin
      .from("bookings")
      .select("google_calendar_event_id")
      .eq("series_id" as never, existing.series_id as never)
      .eq(
        "organization_id",
        membership.organization_id,
      )) as unknown as {
      data: Array<{ google_calendar_event_id: string | null }> | null;
    };

    const { error: delBookingsErr, count: delBookingsCount } = await admin
      .from("bookings")
      .delete({ count: "exact" })
      .eq("series_id" as never, existing.series_id as never)
      .eq("organization_id", membership.organization_id);
    if (delBookingsErr) {
      console.error(
        "[cascade-delete] bulk booking delete failed:",
        delBookingsErr.message,
      );
      throw delBookingsErr;
    }
    console.log(
      `[cascade-delete] removed ${delBookingsCount ?? 0} bookings from series ${existing.series_id}`,
    );

    const { error: delSeriesErr } = (await admin
      .from("booking_series" as never)
      .delete()
      .eq("id" as never, existing.series_id as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )) as unknown as { error: { message: string } | null };
    if (delSeriesErr) {
      console.error(
        "[cascade-delete] series row delete failed:",
        delSeriesErr.message,
      );
    }

    // Fire-and-forget Google Calendar cleanup for every event we had.
    for (const sib of siblings ?? []) {
      if (sib.google_calendar_event_id) {
        deleteCalendarEvent(
          membership.organization_id,
          sib.google_calendar_event_id,
        ).catch((err) =>
          console.error("[gcal] sync error on cascade delete:", err),
        );
      }
    }
  } else {
    // Single-booking delete (existing behavior).
    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", id)
      .eq("organization_id", membership.organization_id);
    if (error) throw error;

    if (existing?.google_calendar_event_id) {
      deleteCalendarEvent(
        membership.organization_id,
        existing.google_calendar_event_id,
      ).catch((err) => console.error("[gcal] sync error on delete:", err));
    }
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app/bookings/series");
  revalidatePath("/app");
  redirect("/app/bookings");
}

/**
 * Skip a single recurring occurrence: add its date to the series'
 * skip_dates array AND delete this particular booking row. The nightly
 * extend cron will not regenerate this date; everything past it keeps
 * going as normal.
 */
export async function skipBookingOccurrenceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  const { data: booking } = (await supabase
    .from("bookings")
    .select("series_id, scheduled_at, google_calendar_event_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      series_id: string | null;
      scheduled_at: string;
      google_calendar_event_id: string | null;
    } | null;
  };

  if (!booking || !booking.series_id) return;

  const skipDate = booking.scheduled_at.slice(0, 10); // YYYY-MM-DD

  // Pull the current skip_dates, append if not already there, write back.
  const { data: seriesRow } = (await supabase
    .from("booking_series" as never)
    .select("skip_dates")
    .eq("id" as never, booking.series_id as never)
    .maybeSingle()) as unknown as {
    data: { skip_dates: string[] | null } | null;
  };

  const existingSkips = seriesRow?.skip_dates ?? [];
  if (!existingSkips.includes(skipDate)) {
    await (supabase
      .from("booking_series" as never)
      .update({ skip_dates: [...existingSkips, skipDate] } as never)
      .eq("id" as never, booking.series_id as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      ) as unknown as Promise<unknown>);
  }

  // Delete this occurrence.
  await supabase
    .from("bookings")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (booking.google_calendar_event_id) {
    deleteCalendarEvent(
      membership.organization_id,
      booking.google_calendar_event_id,
    ).catch((err) =>
      console.error("[gcal] sync error on skip-occurrence:", err),
    );
  }

  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/bookings");
}

/**
 * Cancel all future bookings in a series and deactivate the series.
 */
export async function cancelSeriesAction(formData: FormData) {
  const seriesId = String(formData.get("series_id") ?? "");
  if (!seriesId) return;

  const { membership, supabase } = await getActionContext();

  // Deactivate the series
  await (supabase
    .from("booking_series" as never)
    .update({ active: false } as never)
    .eq("id" as never, seriesId as never) as unknown as Promise<unknown>);

  // Cancel all future pending/confirmed bookings in this series
  const now = new Date().toISOString();
  await (supabase
    .from("bookings")
    .update({ status: "cancelled" } as never)
    .eq("series_id" as never, seriesId as never)
    .in("status" as never, ["pending", "confirmed"] as never)
    .gte("scheduled_at" as never, now as never) as unknown as Promise<unknown>);

  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/bookings");
}
