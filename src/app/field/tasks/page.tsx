import { CalendarClock, RefreshCw } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgTimezone } from "@/lib/org-timezone";
import { describeDue } from "@/lib/task-due";
import { FieldHeader } from "@/components/field-shell";
import { cn } from "@/lib/utils";
import { TaskTick } from "./task-tick";

export const metadata = { title: "My tasks" };

type Row = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  recurrence: string | null;
  completed_at: string | null;
};

const REPEATS: Record<string, string> = {
  daily: "Every day",
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  yearly: "Every year",
};

/**
 * The tasks the office has given THIS person. Until this page existed a task
 * could be assigned to a cleaner and there was nowhere in their app to see
 * it, let alone tick it off.
 */
export default async function FieldTasksPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);
  // eslint-disable-next-line react-hooks/purity
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: open, error }, { data: done }] = (await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, notes, due_at, recurrence, completed_at")
      .eq("organization_id", membership.organization_id)
      .eq("assigned_to", membership.id)
      .is("completed_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from("tasks")
      .select("id, title, notes, due_at, recurrence, completed_at")
      .eq("organization_id", membership.organization_id)
      .eq("assigned_to", membership.id)
      .gte("completed_at", weekAgo)
      .order("completed_at", { ascending: false })
      .limit(50),
  ])) as unknown as [
    { data: Row[] | null; error: { message: string } | null },
    { data: Row[] | null },
  ];

  if (error) throw new Error(error.message);

  const openRows = open ?? [];
  const doneRows = done ?? [];

  return (
    <>
      <FieldHeader title="My tasks" description="Things the office has asked you to do." />

      {openRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
          Nothing to do right now.
        </div>
      ) : (
        <ul className="space-y-3" data-testid="my-open-tasks">
          {openRows.map((t) => {
            const due = t.due_at ? describeDue(t.due_at, tz, now) : null;
            return (
              <li key={t.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
                <TaskTick id={t.id} done={false} title={t.title} />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium [overflow-wrap:anywhere]">{t.title}</p>
                  {t.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {t.notes}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {due && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5",
                          due.urgent ? "font-semibold text-destructive" : "text-muted-foreground",
                        )}
                      >
                        <CalendarClock className="h-4 w-4" />
                        {due.label}
                      </span>
                    )}
                    {t.recurrence && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <RefreshCw className="h-4 w-4" />
                        {REPEATS[t.recurrence] ?? t.recurrence}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {doneRows.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Done in the last week
          </h2>
          <ul className="space-y-2" data-testid="my-done-tasks">
            {doneRows.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 opacity-70"
              >
                <TaskTick id={t.id} done title={t.title} />
                <p className="min-w-0 flex-1 text-base text-muted-foreground line-through [overflow-wrap:anywhere]">
                  {t.title}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
