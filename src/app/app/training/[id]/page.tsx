import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { memberDisplayName } from "@/lib/member-display";
import { formatDate } from "@/lib/format";
import {
  TrainingAssignmentsPanel,
  type AssignmentRow,
} from "./assignments-panel";

export const metadata = { title: "Training module" };

export default async function TrainingModuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: mod }, { data: assignments }, { data: employees }] =
    await Promise.all([
      supabase
        .from("training_modules")
        .select("id, title, description, status")
        .eq("id", id)
        .maybeSingle() as unknown as Promise<{
        data: {
          id: string;
          title: string;
          description: string | null;
          status: string;
        } | null;
      }>,
      supabase
        .from("training_assignments")
        .select(
          "id, employee_id, completed_at, completed_step_ids, assigned_at",
        )
        .eq("module_id", id) as unknown as Promise<{
        data: Array<{
          id: string;
          employee_id: string;
          completed_at: string | null;
          completed_step_ids: string[] | null;
          assigned_at: string | null;
        }> | null;
      }>,
      // Every active member — shadow members included — so the owner can
      // mark anyone trained.
      supabase
        .from("memberships")
        .select(
          "id, role, display_name, profile:profiles ( full_name )",
        )
        .eq("status", "active")
        .eq("organization_id", membership.organization_id),
    ]);

  if (!mod) notFound();

  const byEmployeeId = new Map(
    (assignments ?? []).map((a) => [a.employee_id, a]),
  );

  const rows: AssignmentRow[] = (employees ?? [])
    .map((emp) => {
      const a = byEmployeeId.get(emp.id);
      return {
        employee_id: emp.id,
        employee_name: memberDisplayName(emp),
        role: emp.role,
        assignment_id: a?.id ?? null,
        completed_at: a?.completed_at ?? null,
        assigned_at: a?.assigned_at ?? null,
        progress_steps: a?.completed_step_ids?.length ?? 0,
      };
    })
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name));

  return (
    <PageShell
      title={mod.title}
      description={mod.description ?? "Training module"}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/training"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeft className="h-4 w-4" />
            All modules
          </Link>
          <Link
            href={`/app/training/${mod.id}/edit`}
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <Pencil className="h-4 w-4" />
            Edit module
          </Link>
        </div>
      }
    >
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Employee completions</h2>
          <p className="text-xs text-muted-foreground">
            Status: <span className="font-medium capitalize">{mod.status}</span>
            {" · "}
            {rows.filter((r) => r.completed_at).length} of {rows.length}{" "}
            complete
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active employees yet.
          </p>
        ) : (
          <TrainingAssignmentsPanel moduleId={mod.id} rows={rows} />
        )}

        <p className="mt-4 text-[11px] text-muted-foreground">
          Marking someone complete here is an override — use it for staff who
          were trained before you started using Sollos, manually-added crew
          who don&rsquo;t use the app, or anyone you&rsquo;ve verified in
          person. Last updated {formatDate(new Date().toISOString())}.
        </p>
      </div>
    </PageShell>
  );
}
