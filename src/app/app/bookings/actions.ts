"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { BookingSchema } from "@/lib/validators/bookings";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";

type Field = keyof typeof BookingSchema.shape;
export type BookingFormState = ActionState<Field>;

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
