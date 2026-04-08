import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { TrainingTable, type TrainingRow } from "./training-table";

export const metadata = { title: "Training" };

export default async function TrainingPage() {
  await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("training_modules")
    .select(
      `
        id,
        title,
        description,
        created_at,
        steps:training_steps ( id ),
        assignments:training_assignments ( id, completed_at )
      `,
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows: TrainingRow[] = (data ?? []).map((m) => {
    const assigned = m.assignments?.length ?? 0;
    const completed =
      m.assignments?.filter((a) => a.completed_at != null).length ?? 0;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      created_at: m.created_at,
      step_count: m.steps?.length ?? 0,
      assigned,
      completed,
    };
  });

  return (
    <PageShell
      title="Training"
      description="Modules and progress tracking for your team."
    >
      <TrainingTable rows={rows} />
    </PageShell>
  );
}
