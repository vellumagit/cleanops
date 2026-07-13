import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { TemplateEditor } from "../template-editor";
import { TemplateClientAssign } from "../template-client-assign";

export const metadata = { title: "Edit checklist template" };

export default async function EditChecklistTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: tpl }, { data: items }] = await Promise.all([
    supabase
      .from("checklist_templates" as never)
      .select("id, name, description, applies_to_service_type")
      .eq("id" as never, id as never)
      .maybeSingle() as unknown as Promise<{
      data: {
        id: string;
        name: string;
        description: string | null;
        applies_to_service_type: string | null;
      } | null;
    }>,
    supabase
      .from("checklist_template_items" as never)
      .select("id, ordinal, title, phase, is_required")
      .eq("template_id" as never, id as never)
      .order("ordinal" as never, {
        ascending: true,
      } as never) as unknown as Promise<{
      data: Array<{
        id: string;
        ordinal: number;
        title: string;
        phase: "pre" | "during" | "post";
        is_required: boolean;
      }> | null;
    }>,
  ]);

  if (!tpl) notFound();

  // Clients for the assign control (+ which already use this template).
  const { data: clientRows } = (await supabase
    .from("clients")
    .select("id, name, default_checklist_template_id")
    .eq("organization_id", membership.organization_id)
    .is("archived_at" as never, null as never)
    .order("name", { ascending: true })) as unknown as {
    data: Array<{
      id: string;
      name: string;
      default_checklist_template_id: string | null;
    }> | null;
  };
  const clients = clientRows ?? [];
  const assignedClients = clients
    .filter((c) => c.default_checklist_template_id === id)
    .map((c) => ({ id: c.id, name: c.name }));
  const unassignedClients = clients
    .filter((c) => c.default_checklist_template_id !== id)
    .map((c) => ({ id: c.id, name: c.name }));

  const initialItems = (items ?? []).map((it) => ({
    key: it.id,
    title: it.title,
    phase: it.phase,
    is_required: it.is_required,
  }));

  return (
    <PageShell
      title="Edit checklist template"
      description={tpl.name}
      actions={
        <Link
          href="/app/checklists"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-4 w-4" />
          All templates
        </Link>
      }
    >
      <div className="mx-auto max-w-3xl">
        <TemplateEditor
          mode="edit"
          templateId={tpl.id}
          initialName={tpl.name}
          initialDescription={tpl.description ?? ""}
          initialServiceType={tpl.applies_to_service_type ?? ""}
          initialItems={initialItems}
        />
      </div>

      <TemplateClientAssign
        templateId={tpl.id}
        assigned={assignedClients}
        unassigned={unassignedClients}
      />
    </PageShell>
  );
}
