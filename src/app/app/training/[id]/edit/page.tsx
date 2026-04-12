import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { ModuleForm } from "../../module-form";

export const metadata = { title: "Edit training module" };

export default async function EditTrainingModulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: module }, { data: steps }] = await Promise.all([
    supabase
      .from("training_modules")
      .select("id, title, description, status" as never)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("training_steps")
      .select("id, ord, body, image_url")
      .eq("module_id", id)
      .order("ord", { ascending: true }),
  ]);

  if (!module) notFound();

  const mod = module as unknown as {
    id: string;
    title: string;
    description: string | null;
    status: string;
  };

  const initialSteps = (steps ?? []).map((s) => ({
    title: "",
    body: s.body,
    image_url: s.image_url,
  }));

  return (
    <PageShell
      title="Edit training module"
      description={`Editing "${mod.title}"`}
      actions={
        <Link
          href="/app/training"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" /> Back to training
        </Link>
      }
    >
      <ModuleForm
        mode="edit"
        moduleId={mod.id}
        initialTitle={mod.title}
        initialDescription={mod.description ?? ""}
        initialStatus={mod.status ?? "draft"}
        initialSteps={initialSteps}
      />
    </PageShell>
  );
}
