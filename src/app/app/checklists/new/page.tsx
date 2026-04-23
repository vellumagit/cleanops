import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { TemplateEditor } from "../template-editor";

export const metadata = { title: "New checklist template" };

export default async function NewChecklistTemplatePage() {
  await requireMembership(["owner", "admin", "manager"]);

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
        <TemplateEditor mode="create" />
      </div>
    </PageShell>
  );
}
