import Link from "next/link";
import { ChevronRight, CircleCheck } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { cn } from "@/lib/utils";

export const metadata = { title: "Training" };

export default async function FieldTrainingPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("training_assignments")
    .select(
      `
        id,
        completed_at,
        completed_step_ids,
        module:training_modules (
          id,
          title,
          description,
          steps:training_steps ( id )
        )
      `,
    )
    .eq("employee_id", membership.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const assignments = (data ?? []).filter((a) => a.module);

  return (
    <>
      <FieldHeader
        title="Training"
        description="Modules your team has assigned to you."
      />

      {assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
          No training modules assigned yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {assignments.map((a) => {
            const totalSteps = a.module?.steps?.length ?? 0;
            const doneSteps = (a.completed_step_ids ?? []).length;
            const isDone = Boolean(a.completed_at);
            const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
            return (
              <li key={a.id}>
                <Link
                  href={`/field/training/${a.module!.id}`}
                  className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors active:bg-muted"
                >
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                      isDone
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <CircleCheck className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">
                      {a.module!.title}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {doneSteps} / {totalSteps} steps
                      {isDone ? " · Complete" : ""}
                    </div>
                    {/* Progress bar */}
                    {!isDone && totalSteps > 0 && (
                      <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
