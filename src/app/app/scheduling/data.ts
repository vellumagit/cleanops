import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "en_route"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ScheduleBooking = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: BookingStatus;
  service_type: string;
  assigned_to: string | null;
  client_name: string;
  address: string | null;
};

export type ScheduleEmployee = {
  id: string;
  name: string;
};

/** Returns Monday at 00:00 local for the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay(); // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // shift so Mon = day 0
  out.setDate(out.getDate() + offset);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Parse ?week=YYYY-MM-DD or default to this week (Monday). */
export function parseWeekParam(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const candidate = new Date(y, m - 1, d);
    if (!Number.isNaN(candidate.getTime())) return startOfWeek(candidate);
  }
  return startOfWeek(new Date());
}

export function formatWeekParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchScheduleWeek(weekStart: Date): Promise<{
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
}> {
  const supabase = await createSupabaseServerClient();
  const weekEnd = addDays(weekStart, 7);

  const [bookingsRes, membersRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `
          id,
          scheduled_at,
          duration_minutes,
          status,
          service_type,
          assigned_to,
          address,
          client:clients ( name )
        `,
      )
      .gte("scheduled_at", weekStart.toISOString())
      .lt("scheduled_at", weekEnd.toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("memberships")
      .select("id, role, status, profile:profiles ( full_name )")
      .eq("status", "active")
      .in("role", ["employee", "admin", "owner"]),
  ]);

  if (bookingsRes.error) throw bookingsRes.error;
  if (membersRes.error) throw membersRes.error;

  const bookings: ScheduleBooking[] = (bookingsRes.data ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    duration_minutes: b.duration_minutes,
    status: b.status,
    service_type: b.service_type,
    assigned_to: b.assigned_to,
    client_name: b.client?.name ?? "—",
    address: b.address,
  }));

  const employees: ScheduleEmployee[] = (membersRes.data ?? [])
    .map((m) => ({
      id: m.id,
      name: m.profile?.full_name ?? "Unnamed",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { bookings, employees };
}
