import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { TaskRow, type TaskRowData } from "./task-row";
import { memberDisplayName } from "@/lib/member-display";
import { isPast, isToday } from "date-fns";

export const metadata = { title: "Tasks" };

type RawTask = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  remind_at: string | null;
  recurrence: string | null;
  completed_at: string | null;
  assigned: {
    display_name: string | null;
    profile: { full_name: string | null } | null;
  } | null;
};

function groupTasks(tasks: TaskRowData[]): {
  overdue: TaskRowData[];
  today: TaskRowData[];
  upcoming: TaskRowData[];
  noDue: TaskRowData[];
  completed: TaskRowData[];
} {
  const overdue: TaskRowData[] = [];
  const today: TaskRowData[] = [];
  const upcoming: TaskRowData[] = [];
  const noDue: TaskRowData[] = [];
  const completed: TaskRowData[] = [];

  for (const t of tasks) {
    if (t.completed_at) {
      completed.push(t);
      continue;
    }
    if (!t.due_at) {
      noDue.push(t);
      continue;
    }
    const d = new Date(t.due_at);
    if (isPast(d) && !isToday(d)) {
      overdue.push(t);
    } else if (isToday(d)) {
      today.push(t);
    } else {
      upcoming.push(t);
    }
  }

  return { overdue, today, upcoming, noDue, completed };
}

function Section({
  title,
  tasks,
  canManage,
  accent,
}: {
  title: string;
  tasks: TaskRowData[];
  canManage: boolean;
  accent?: string;
}) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <h2
        className={`mb-2 text-xs font-semibold uppercase tracking-wider ${accent ?? "text-muted-foreground"}`}
      >
        {title} ({tasks.length})
      </h2>
      <div className="space-y-1.5">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

export default async function TasksPage() {
  const membership = await requireMembership();
  const canManage = ["owner", "admin", "manager"].includes(membership.role);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("tasks" as never)
    .select(
      `id, title, notes, due_at, remind_at, recurrence, completed_at,
       assigned:memberships ( display_name, profile:profiles ( full_name ) )`,
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500) as unknown as { data: RawTask[] | null; error: Error | null };

  if (error) throw error;

  const rows: TaskRowData[] = (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    due_at: t.due_at,
    remind_at: t.remind_at,
    recurrence: t.recurrence,
    completed_at: t.completed_at,
    assigned_member: t.assigned ? memberDisplayName(t.assigned) : null,
  }));

  const { overdue, today, upcoming, noDue, completed } = groupTasks(rows);
  const hasAny = rows.length > 0;

  return (
    <PageShell
      title="Tasks & Reminders"
      description="To-do items, supply reminders, and recurring checklists for your team."
      actions={
        canManage ? (
          <Link
            href="/app/tasks/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New task
          </Link>
        ) : null
      }
    >
      {!hasAny ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">No tasks yet</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Add a to-do, set a reminder, or create a recurring task to keep
            your team on track.
          </p>
          {canManage && (
            <Link
              href="/app/tasks/new"
              className={`mt-4 ${buttonVariants({ variant: "default", size: "sm" })}`}
            >
              <Plus className="h-4 w-4" />
              New task
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <Section
            title="Overdue"
            tasks={overdue}
            canManage={canManage}
            accent="text-destructive"
          />
          <Section
            title="Today"
            tasks={today}
            canManage={canManage}
            accent="text-amber-500"
          />
          <Section title="Upcoming" tasks={upcoming} canManage={canManage} />
          <Section title="No due date" tasks={noDue} canManage={canManage} />
          <Section
            title="Completed"
            tasks={completed}
            canManage={canManage}
            accent="text-emerald-600"
          />
        </div>
      )}
    </PageShell>
  );
}
