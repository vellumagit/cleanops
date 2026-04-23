import Link from "next/link";
import { Plus, ClipboardCheck, Trash2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { deleteChecklistTemplateAction } from "./actions";

export const metadata = { title: "Checklists" };

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  applies_to_service_type: string | null;
  is_active: boolean;
  item_count: number;
};

export default async function ChecklistsPage() {
  await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  const { data } = (await supabase
    .from("checklist_templates" as never)
    .select(
      `id, name, description, applies_to_service_type, is_active,
       items:checklist_template_items ( id )`,
    )
    .order("created_at" as never, {
      ascending: false,
    } as never)) as unknown as {
    data: Array<{
      id: string;
      name: string;
      description: string | null;
      applies_to_service_type: string | null;
      is_active: boolean;
      items: Array<{ id: string }> | null;
    }> | null;
  };

  const rows: TemplateRow[] = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    applies_to_service_type: t.applies_to_service_type,
    is_active: t.is_active,
    item_count: t.items?.length ?? 0,
  }));

  return (
    <PageShell
      title="Checklists"
      description="Reusable checklists for your crew to work through on every job."
      actions={
        <Link
          href="/app/checklists/new"
          className={buttonVariants({ size: "sm" })}
        >
          <Plus className="h-4 w-4" />
          New template
        </Link>
      }
    >
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No templates yet. Build one to standardize how every job wraps
            up — a moving-out deep-clean checklist, a weekly-office
            routine, an end-of-shift inspection.
          </p>
          <Link
            href="/app/checklists/new"
            className={
              buttonVariants({ size: "sm" }) + " mt-4 inline-flex"
            }
          >
            <Plus className="h-4 w-4" />
            Create your first template
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/checklists/${t.id}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {t.name}
                  </Link>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t.item_count} item{t.item_count === 1 ? "" : "s"}
                    {t.applies_to_service_type
                      ? ` · auto-applies to ${t.applies_to_service_type.replace(/_/g, " ")}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/app/checklists/${t.id}`}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Edit
                  </Link>
                  <form action={deleteChecklistTemplateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <SubmitButton
                      variant="ghost"
                      size="sm"
                      pendingLabel="…"
                      className="text-red-700 hover:bg-red-500/10 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
