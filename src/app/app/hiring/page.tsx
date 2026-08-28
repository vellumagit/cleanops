import Link from "next/link";
import { MessageCircleQuestion, ListChecks, Trash2, Users } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { HiringDocDialog } from "./hiring-doc-dialog";
import { deleteHiringDocAction } from "./actions";

export const metadata = { title: "Hiring" };

type Doc = {
  id: string;
  kind: "questionnaire" | "procedure";
  title: string;
  items: string[];
  notes: string | null;
};

/**
 * The hiring library — what the owner works FROM before the yes.
 * Deliberately separate from Training (what a new employee works THROUGH
 * after it). Brian: "I should be able to create job interview
 * questionnaires ... hiring procedures, this kind of thing."
 */
export default async function HiringPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: rows } = (await supabase
    .from("hiring_docs" as never)
    .select("id, kind, title, items, notes")
    .eq("organization_id" as never, membership.organization_id as never)
    .order("created_at" as never, { ascending: true } as never)) as unknown as {
    data: Doc[] | null;
  };
  const docs = rows ?? [];
  const questionnaires = docs.filter((d) => d.kind === "questionnaire");
  const procedures = docs.filter((d) => d.kind === "procedure");

  const renderGroup = (
    label: string,
    blurb: string,
    icon: React.ReactNode,
    kind: "questionnaire" | "procedure",
    items: Doc[],
    emptyCopy: string,
  ) => (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {label}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
        </div>
        <HiringDocDialog kind={kind} />
      </div>
      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center text-xs text-muted-foreground">
          {emptyCopy}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((d) => (
            <li key={d.id} className="rounded-lg border border-border/70">
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="text-sm font-medium">{d.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {d.items.length}{" "}
                    {kind === "questionnaire" ? "questions" : "steps"}
                    <HiringDocDialog kind={kind} doc={d} />
                    <form action={deleteHiringDocAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <SubmitButton
                        variant="ghost"
                        size="sm"
                        pendingLabel="…"
                        className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </SubmitButton>
                    </form>
                  </span>
                </summary>
                <div className="border-t border-border/60 px-4 py-3">
                  {d.notes && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      {d.notes}
                    </p>
                  )}
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {d.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ol>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <PageShell
      title="Hiring"
      description="What you work from before the yes — questionnaires for the interview, procedures for everything around it."
      actions={
        <Link
          href="/app/applicants"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Users className="h-4 w-4" />
          Applicants
        </Link>
      }
    >
      <div className="max-w-3xl space-y-6">
        {renderGroup(
          "Interview questionnaires",
          "Open one during the call and work down the list — same questions for every candidate.",
          <MessageCircleQuestion className="h-4 w-4" />,
          "questionnaire",
          questionnaires,
          "No questionnaires yet. Write your interview once, ask it consistently forever.",
        )}
        {renderGroup(
          "Hiring procedures",
          "The steps from yes to first shift — documents to collect, accounts to set up, training to assign.",
          <ListChecks className="h-4 w-4" />,
          "procedure",
          procedures,
          "No procedures yet. Write down the steps so hiring never depends on memory.",
        )}
        <p className="text-xs text-muted-foreground">
          Once they&rsquo;re hired: onboarding content lives in{" "}
          <Link href="/app/training" className="underline underline-offset-2">
            Training
          </Link>{" "}
          — what a new employee works through, not what you hire from.
        </p>
      </div>
    </PageShell>
  );
}
