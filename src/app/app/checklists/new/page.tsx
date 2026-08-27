import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { TemplateEditor } from "../template-editor";

export const metadata = { title: "New checklist template" };

export default async function NewChecklistTemplatePage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  // The org's real service catalog for the auto-attach select.
  const { data: serviceRows } = (await supabase
    .from("service_types" as never)
    .select("id, name")
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("is_active" as never, true as never)
    .order("sort_order" as never, { ascending: true } as never)
    .order("name" as never, { ascending: true } as never)) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };
  const services = (serviceRows ?? []).map((s) => ({
    id: s.id,
    label: s.name,
  }));

  return (
    <PageShell
      title="New checklist template"
      description="Build a reusable list of items your crew ticks off on every job."
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
        <TemplateEditor mode="create" services={services} />
      </div>
    </PageShell>
  );
}
