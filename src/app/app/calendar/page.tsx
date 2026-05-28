import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { CalendarView } from "./calendar-view";
import { listCalendarEvents } from "@/lib/google-calendar";
import { memberDisplayName } from "@/lib/member-display";
import { fetchBookingFormOptions } from "@/app/app/bookings/options";
import { getOrgCurrency } from "@/lib/org-currency";
import { getOrgTimezone } from "@/lib/org-timezone";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  addMonths,
  format,
} from "date-fns";

export const metadata = { title: "Calendar" };

type BookingEvent = {
  id: string;
  type: "booking";
  title: string;
  start: string;
  end: string;
  status: string;
  color: string;
  meta: {
    client: string;
    employee: string | null;
    service_type: string;
    address: string | null;
  };
};

type InvoiceEvent = {
  id: string;
  type: "invoice";
  title: string;
  start: string;
  end: string;
  status: string;
  color: string;
  meta: {
    client: string;
    amount: number;
    number: string | null;
  };
};

type GoogleCalEvent = {
  id: string;
  type: "google_calendar";
  title: string;
  start: string;
  end: string;
  status: string;
  color: string;
  meta: {
    description?: string;
    location?: string;
    htmlLink?: string;
  };
};

type TaskEvent = {
  id: string;
  type: "task";
  title: string;
  start: string;
  end: string;
  status: string;
  color: string;
  meta: {
    notes: string | null;
    assignee: string | null;
    recurrence: string | null;
    completed: boolean;
  };
};

export type CalendarEvent = BookingEvent | InvoiceEvent | GoogleCalEvent | TaskEvent;

function getStatusColor(status: string): string {
  switch (status) {
    case "confirmed":
      return "#3b82f6"; // blue
    case "in_progress":
      return "#f59e0b"; // amber
    case "completed":
      return "#22c55e"; // green
    case "cancelled":
      return "#ef4444"; // red
    case "pending":
      return "#a1a1aa"; // zinc
    default:
      return "#71717a"; // zinc-500
  }
}

function getInvoiceColor(status: string): string {
  switch (status) {
    case "paid":
      return "#22c55e";
    case "overdue":
      return "#ef4444";
    case "sent":
      return "#3b82f6";
    default:
      return "#a1a1aa";
  }
}

export default async function CalendarPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  // Fetch a 3-month window (prev, current, next) so client can navigate
  const now = new Date();
  const rangeStart = startOfMonth(subMonths(now, 1));
  const rangeEnd = endOfMonth(addMonths(now, 1));

  const [bookingsResult, invoicesResult, gcalEvents, tasksResult, formOptions, currency, tz] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        `id, scheduled_at, duration_minutes, service_type, status, address,
         client:clients ( name ),
         assigned:memberships ( display_name, profile:profiles ( full_name ) )`,
      )
      .gte("scheduled_at", rangeStart.toISOString())
      .lte("scheduled_at", rangeEnd.toISOString())
      .order("scheduled_at"),

    supabase
      .from("invoices")
      .select(
        `id, due_date, status, amount_cents, number,
         client:clients ( name )`,
      )
      .gte("due_date", format(rangeStart, "yyyy-MM-dd"))
      .lte("due_date", format(rangeEnd, "yyyy-MM-dd"))
      .order("due_date"),

    listCalendarEvents(
      membership.organization_id,
      rangeStart.toISOString(),
      rangeEnd.toISOString(),
    ),
    supabase
      .from("tasks" as never)
      // Explicit FK name — tasks has both created_by and assigned_to
      // pointing at memberships, so PostgREST refuses the bare embed.
      .select(
        `id, title, notes, due_at, recurrence, completed_at,
         assigned:memberships!tasks_assigned_to_fkey (
           display_name, profile:profiles ( full_name )
         )`,
      )
      .gte("due_at" as never, rangeStart.toISOString())
      .lte("due_at" as never, rangeEnd.toISOString())
      .order("due_at") as unknown as Promise<{
      data: Array<{
        id: string;
        title: string;
        notes: string | null;
        due_at: string;
        recurrence: string | null;
        completed_at: string | null;
        assigned: {
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      }> | null;
    }>,
    fetchBookingFormOptions(),
    getOrgCurrency(membership.organization_id),
    getOrgTimezone(membership.organization_id),
  ]);

  const bookingEvents: CalendarEvent[] = (bookingsResult.data ?? []).map(
    (b) => {
      const start = new Date(b.scheduled_at);
      const end = new Date(
        start.getTime() + (b.duration_minutes ?? 60) * 60_000,
      );
      const clientName =
        (b.client as unknown as { name: string } | null)?.name ?? "No client";
      // Use memberDisplayName so shadow-employees (manually added via
      // Settings → Members) show their display_name instead of blank.
      const assignedRow = b.assigned as unknown as {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
      const employeeName = assignedRow
        ? memberDisplayName(assignedRow)
        : null;

      return {
        id: b.id,
        type: "booking" as const,
        title: `${b.service_type ?? "Cleaning"} — ${clientName}`,
        start: start.toISOString(),
        end: end.toISOString(),
        status: b.status,
        color: getStatusColor(b.status),
        meta: {
          client: clientName,
          employee: employeeName,
          service_type: b.service_type ?? "standard",
          address: b.address,
        },
      };
    },
  );

  const invoiceEvents: CalendarEvent[] = (invoicesResult.data ?? []).map(
    (inv) => {
      const clientName =
        (inv.client as unknown as { name: string } | null)?.name ?? "No client";
      const dueDate = new Date(inv.due_date + "T09:00:00");

      return {
        id: inv.id,
        type: "invoice" as const,
        title: `${inv.number ?? "Invoice"} — ${clientName}`,
        start: dueDate.toISOString(),
        end: dueDate.toISOString(),
        status: inv.status,
        color: getInvoiceColor(inv.status),
        meta: {
          client: clientName,
          amount: inv.amount_cents ?? 0,
          number: inv.number,
        },
      };
    },
  );

  const googleEvents: CalendarEvent[] = gcalEvents.map((ge) => ({
    id: `gcal_${ge.id}`,
    type: "google_calendar" as const,
    title: ge.summary,
    start: ge.start.length === 10 ? `${ge.start}T00:00:00` : ge.start,
    end: (ge.end || ge.start).length === 10
      ? `${ge.end || ge.start}T23:59:59`
      : ge.end || ge.start,
    status: "external",
    color: "#8b5cf6", // purple
    meta: {
      description: ge.description,
      location: ge.location,
      htmlLink: ge.htmlLink,
    },
  }));

  const taskEvents: CalendarEvent[] = (tasksResult.data ?? []).map((t) => {
    const start = new Date(t.due_at);
    const assigneeName = t.assigned ? memberDisplayName(t.assigned) : null;
    return {
      id: `task_${t.id}`,
      type: "task" as const,
      title: `☐ ${t.title}`,
      start: start.toISOString(),
      end: start.toISOString(),
      status: t.completed_at ? "completed" : "pending",
      color: t.completed_at ? "#22c55e" : "#8b5cf6", // violet for pending, green for done
      meta: {
        notes: t.notes,
        assignee: assigneeName,
        recurrence: t.recurrence,
        completed: !!t.completed_at,
      },
    };
  });

  const events = [...bookingEvents, ...invoiceEvents, ...googleEvents, ...taskEvents];
  const hasGoogleCalendar = gcalEvents.length > 0;

  return (
    <PageShell
      title="Calendar"
      description="View bookings, invoices, and events across your organization."
    >
      <CalendarView
        events={events}
        hasGoogleCalendar={hasGoogleCalendar}
        formOptions={formOptions}
        currency={currency}
        tz={tz}
      />
    </PageShell>
  );
}
