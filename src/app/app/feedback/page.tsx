import Link from "next/link";
import { Plus, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge, feedbackStatusTone } from "@/components/status-badge";
import { memberDisplayName } from "@/lib/member-display";
import {
  feedbackKindLabel,
  feedbackStatusLabel,
  type FeedbackStatus,
} from "@/lib/validators/feedback";

export const metadata = { title: "Feedback" };

type ItemRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  page_context: string | null;
  created_by: string | null;
  last_activity_at: string;
  created_at: string;
};

function relative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

function Row({
  item,
  who,
  replies,
}: {
  item: ItemRow;
  who: string | null;
  replies: number;
}) {
  return (
    <Link
      href={`/app/feedback/${item.id}`}
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {feedbackKindLabel(item.kind)}
          {who ? ` · ${who}` : ""} · {relative(item.last_activity_at)}
          {item.page_context ? ` · ${item.page_context}` : ""}
        </p>
      </div>
      {replies > 0 && (
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          {replies}
        </span>
      )}
      <StatusBadge
        tone={feedbackStatusTone(item.status as FeedbackStatus)}
        className="mt-0.5 shrink-0"
      >
        {feedbackStatusLabel(item.status)}
      </StatusBadge>
    </Link>
  );
}

function Section({
  title,
  hint,
  items,
  names,
  replyCounts,
  accent,
}: {
  title: string;
  hint?: string;
  items: ItemRow[];
  names: Map<string, string>;
  replyCounts: Map<string, number>;
  accent?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h2
        className={`mb-1 text-xs font-semibold uppercase tracking-wider ${accent ?? "text-muted-foreground"}`}
      >
        {title} ({items.length})
      </h2>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {items.map((i) => (
          <Row
            key={i.id}
            item={i}
            who={i.created_by ? names.get(i.created_by) ?? null : null}
            replies={replyCounts.get(i.id) ?? 0}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The feedback board — bugs, ideas, and questions, in place of voice memos.
 *
 * Sorted by the one thing that unsticks a conversation: whose turn it is.
 * "Needs your answer" sits at the top in the app's needs-a-human amber,
 * because an item waiting on the org is the only kind nobody else can move.
 */
export default async function FeedbackPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = (await supabase
    .from("feedback_items" as never)
    .select(
      "id, kind, title, status, page_context, created_by, last_activity_at, created_at",
    )
    .order("last_activity_at", { ascending: false })
    .limit(200)) as unknown as {
    data: ItemRow[] | null;
    error: { message: string } | null;
  };

  if (error) {
    return (
      <PageShell title="Feedback" description="Bugs, ideas, and questions.">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load the board: {error.message}
        </div>
      </PageShell>
    );
  }

  const items = data ?? [];

  // Two-step name lookup rather than a PostgREST embed. The tasks page had to
  // learn this the hard way: embeds that name an auto-generated FK constraint
  // blow up at runtime when the constraint name differs between schemas.
  const authorIds = Array.from(
    new Set(items.map((i) => i.created_by).filter((v): v is string => !!v)),
  );
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: members } = (await supabase
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .in("id", authorIds)) as unknown as {
      data: Array<{
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }> | null;
    };
    for (const m of members ?? []) names.set(m.id, memberDisplayName(m));
  }

  // Reply counts, so a thread that has been answered reads differently from
  // one nobody has touched.
  const replyCounts = new Map<string, number>();
  if (items.length > 0) {
    const { data: replies } = (await supabase
      .from("feedback_replies" as never)
      .select("feedback_item_id")
      .in(
        "feedback_item_id",
        items.map((i) => i.id),
      )) as unknown as {
      data: Array<{ feedback_item_id: string }> | null;
    };
    for (const r of replies ?? []) {
      replyCounts.set(
        r.feedback_item_id,
        (replyCounts.get(r.feedback_item_id) ?? 0) + 1,
      );
    }
  }

  const by = (s: FeedbackStatus) => items.filter((i) => i.status === s);
  const needsAnswer = by("needs_answer");
  const open = by("open");
  const inProgress = by("in_progress");
  const done = items.filter(
    (i) => i.status === "shipped" || i.status === "closed",
  );

  const isField = membership.role === "employee";

  return (
    <PageShell
      title="Feedback"
      description={
        isField
          ? "Report anything that looks wrong. You'll see replies here."
          : "Bugs, ideas, and questions — with the Sollos team, in writing."
      }
      actions={
        <Link
          href="/app/feedback/new"
          className={buttonVariants({ variant: "default" })}
        >
          <Plus className="h-4 w-4" />
          New
        </Link>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-foreground">Nothing here yet</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Anything broken, any idea, any question — put it here instead of a
            voice message. It keeps its own thread, and you can see what
            happened to it.
          </p>
          <Link
            href="/app/feedback/new"
            className={`mt-4 ${buttonVariants({ variant: "default", size: "sm" })}`}
          >
            <Plus className="h-4 w-4" />
            Report something
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          <Section
            title="Needs your answer"
            hint="Sollos is blocked on these — a reply is all it takes."
            items={needsAnswer}
            names={names}
            replyCounts={replyCounts}
            accent="text-amber-500"
          />
          <Section
            title="With Sollos"
            items={open}
            names={names}
            replyCounts={replyCounts}
          />
          <Section
            title="Being built"
            items={inProgress}
            names={names}
            replyCounts={replyCounts}
            accent="text-violet-500"
          />
          <Section
            title="Done"
            items={done}
            names={names}
            replyCounts={replyCounts}
            accent="text-emerald-600"
          />
        </div>
      )}
    </PageShell>
  );
}
