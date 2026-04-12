import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { ModuleForm } from "../module-form";

export const metadata = { title: "New training module" };

export default async function NewTrainingModulePage() {
  await requireMembership(["owner", "admin", "manager"]);

  return (
    <PageShell
      title="New training module"
      description="Build a step-by-step guide your team can work through."
      actions={
        <Link
          href="/app/training"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" /> Back to training
        </Link>
      }
    >
      <ModuleForm mode="create" />
    </PageShell>
  );
}
