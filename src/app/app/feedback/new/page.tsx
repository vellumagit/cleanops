import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { FeedbackForm } from "../feedback-form";

export const metadata = { title: "New feedback" };

type Props = {
  searchParams: Promise<{ page?: string; kind?: string }>;
};

/**
 * Filing an item.
 *
 * `?page=` carries the path the reporter was actually on — the assistant
 * widget and the "report a problem" links pass it, so the report arrives
 * already knowing where the problem was without anyone typing it. Only
 * in-app paths are honoured; anything else is dropped rather than stored.
 */
export default async function NewFeedbackPage({ searchParams }: Props) {
  await requireMembership();
  const sp = await searchParams;

  const from =
    sp.page && sp.page.startsWith("/") && !sp.page.startsWith("//")
      ? sp.page.slice(0, 200)
      : null;

  return (
    <PageShell
      title="Report something"
      description="Anything broken, any idea, any question. It gets a thread you can follow."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <FeedbackForm pageContext={from} defaultKind={sp.kind} />
      </div>
    </PageShell>
  );
}
