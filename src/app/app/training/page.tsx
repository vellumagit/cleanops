import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { TrainingTable, type TrainingRow } from "./training-table";

export const metadata = { title: "Training" };

export default async function TrainingPage() {
  await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("training_modules")
    .select(
      `
        id,
        title,
        description,
        created_at,
        status,
        steps:training_steps ( id ),
        assignments:training_assignments ( id, completed_at )
      ` as never,
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows: TrainingRow[] = ((data ?? []) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    created_at: string;
    status: string | null;
    steps: Array<{ id: string }> | null;
    assignments: Array<{ id: string; completed_at: string | null }> | null;
  }>).map((m) => {
    const assigned = m.assignments?.length ?? 0;
    const completed =
      m.assignments?.filter((a) => a.completed_at != null).length ?? 0;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      created_at: m.created_at,
      status: m.status ?? "draft",
      step_count: m.steps?.length ?? 0,
      assigned,
      completed,
    };
  });

  return (
    <PageShell
      title="Training"
      description="Build training modules for your team."
      actions={
        <Link
          href="/app/training/new"
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          New module
        </Link>
      }
    >
      <TrainingTable rows={rows} />
    </PageShell>
  );
}
