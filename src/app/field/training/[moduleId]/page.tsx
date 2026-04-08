import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StepToggle } from "./step-toggle";

export const metadata = { title: "Training module" };

export default async function FieldTrainingModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const membership = await requireMembership();
  const { moduleId } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: assignment }, { data: module }, { data: steps }] =
    await Promise.all([
      supabase
        .from("training_assignments")
        .select("id, completed_at, completed_step_ids")
        .eq("module_id", moduleId)
        .eq("employee_id", membership.id)
        .maybeSingle(),
      supabase
        .from("training_modules")
        .select("id, title, description")
        .eq("id", moduleId)
        .maybeSingle(),
      supabase
        .from("training_steps")
        .select("id, ord, body, image_url")
        .eq("module_id", moduleId)
        .order("ord", { ascending: true }),
    ]);

  if (!module) notFound();
  if (!assignment) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        This training module isn&apos;t assigned to you.
        <div className="mt-3">
          <Link
            href="/field/training"
            className="text-primary underline underline-offset-2"
          >
            Back to training
          </Link>
        </div>
      </div>
    );
  }

  const doneSet = new Set<string>(assignment.completed_step_ids ?? []);
  const totalSteps = steps?.length ?? 0;
  const doneCount = (steps ?? []).filter((s) => doneSet.has(s.id)).length;
  const isAllDone = totalSteps > 0 && doneCount === totalSteps;

  return (
    <div className="space-y-5">
      <Link
        href="/field/training"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" /> All training
      </Link>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{module.title}</h1>
        {module.description ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {module.description}
          </p>
        ) : null}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{
              width: `${
                totalSteps === 0 ? 0 : (doneCount / totalSteps) * 100
              }%`,
            }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {doneCount} of {totalSteps} steps complete
          {isAllDone ? " · finished" : ""}
        </p>
      </div>

      {(steps ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
          No steps in this module yet.
        </div>
      ) : (
        <ol className="space-y-3">
          {(steps ?? []).map((step, idx) => {
            const done = doneSet.has(step.id);
            return (
              <li
                key={step.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
              >
                <StepToggle
                  moduleId={module.id}
                  stepId={step.id}
                  done={done}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Step {idx + 1}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">
                    {step.body}
                  </p>
                  {step.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={step.image_url}
                      alt={`Step ${idx + 1} reference`}
                      className="mt-2 max-h-48 rounded border border-border object-cover"
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
