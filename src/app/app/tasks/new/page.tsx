import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { TaskForm } from "../task-form";
import { fetchTaskMemberOptions } from "../options";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "New task" };

export default async function NewTaskPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const [members, timezone] = await Promise.all([
    fetchTaskMemberOptions(),
    getOrgTimezone(membership.organization_id),
  ]);

  return (
    <PageShell
      title="New task"
      description="Create a to-do item or reminder for your team."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <TaskForm mode="create" members={members} timezone={timezone} />
      </div>
    </PageShell>
  );
}
