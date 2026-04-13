import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { TimesheetsTable, type TimesheetRow } from "./timesheets-table";
import { DEFAULT_TZ } from "@/lib/format";

export const metadata = { title: "Timesheets" };

function diffMinutes(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

export default async function TimesheetsPage() {
  await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  // Default: last 30 days
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error } = await supabase
    .from("time_entries")
    .select(
      `
        id,
        clock_in_at,
        clock_out_at,
        notes,
        employee:memberships ( id, profile:profiles ( full_name ) ),
        booking:bookings ( id, client:clients ( name ), service_type )
      `,
    )
    .gte("clock_in_at", since.toISOString())
    .order("clock_in_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  // Build per-employee summary + individual entries
  type EmpSummary = {
    id: string;
    name: string;
    totalMinutes: number;
    shiftCount: number;
    openShift: boolean;
  };

  const empMap = new Map<string, EmpSummary>();
  const rows: TimesheetRow[] = [];

  for (const entry of data ?? []) {
    const empId = entry.employee?.id ?? "unknown";
    const empName = entry.employee?.profile?.full_name ?? "Unknown";
    const isOpen = !entry.clock_out_at;
    const minutes =
      entry.clock_in_at && entry.clock_out_at
        ? diffMinutes(entry.clock_in_at, entry.clock_out_at)
        : 0;

    // Per-employee summary
    const existing = empMap.get(empId) ?? {
      id: empId,
      name: empName,
      totalMinutes: 0,
      shiftCount: 0,
      openShift: false,
    };
    existing.totalMinutes += minutes;
    existing.shiftCount += 1;
    if (isOpen) existing.openShift = true;
    empMap.set(empId, existing);

    // Individual row
    rows.push({
      id: entry.id,
      employee_id: empId,
      employee_name: empName,
      clock_in_at: entry.clock_in_at,
      clock_out_at: entry.clock_out_at,
      duration_minutes: minutes,
      client_name: entry.booking?.client?.name ?? null,
      service_type: entry.booking?.service_type ?? null,
      notes: entry.notes,
      is_open: isOpen,
    });
  }

  const summaries = Array.from(empMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes,
  );

  return (
    <PageShell
      title="Timesheets"
      description={`Employee hours overview — last 30 days (${DEFAULT_TZ}).`}
    >
      <TimesheetsTable rows={rows} summaries={summaries} />
    </PageShell>
  );
}
