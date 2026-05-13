import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { TaskForm } from "../../task-form";
import { fetchTaskMemberOptions } from "../../options";

export const metadata = { title: "Edit task" };

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: task }, members] = await Promise.all([
    supabase
      .from("tasks" as never)
      .select(
        "id, title, notes, assigned_to, due_at, remind_at, recurrence",
      )
      .eq("id" as never, id)
      .maybeSingle() as unknown as {
      data: {
        id: string;
        title: string;
        notes: string | null;
        assigned_to: string | null;
        due_at: string | null;
        remind_at: string | null;
        recurrence: string | null;
      } | null;
    },
    fetchTaskMemberOptions(),
  ]);

  if (!task) notFound();

  return (
    <PageShell title="Edit task">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <TaskForm
          mode="edit"
          id={task.id}
          defaults={{
            title: task.title,
            notes: task.notes,
            assigned_to: task.assigned_to,
            due_at: task.due_at,
            remind_at: task.remind_at,
            recurrence: task.recurrence,
          }}
          members={members}
        />
      </div>
    </PageShell>
  );
}
