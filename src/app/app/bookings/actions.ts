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
  redirect("/app/bookings");
}

export async function createRecurringBookingAction(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const raw = readRecurringFormValues(formData);
  const parsed = parseForm(RecurringBookingSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors as BookingFormState["errors"], values: raw };

  const { membership, supabase } = await getActionContext();

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
  redirect("/app/bookings");
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

  // Fetch the existing event ID before updating
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { google_calendar_event_id: string | null } | null;
  };

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
  const { membership, supabase } = await getActionContext();

  // Fetch the Google Calendar event ID before deleting
  const { data: existing } = (await supabase
    .from("bookings")
    .select("google_calendar_event_id")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { google_calendar_event_id: string | null } | null;
  };

  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) throw error;

  // Delete from Google Calendar
  if (existing?.google_calendar_event_id) {
    deleteCalendarEvent(
      membership.organization_id,
      existing.google_calendar_event_id,
    ).catch((err) => console.error("[gcal] sync error on delete:", err));
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
