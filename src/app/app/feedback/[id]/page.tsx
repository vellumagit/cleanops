import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { StatusBadge, feedbackStatusTone } from "@/components/status-badge";
import { memberDisplayName } from "@/lib/member-display";
import {
  feedbackKindLabel,
  feedbackStatusLabel,
  type FeedbackStatus,
} from "@/lib/validators/feedback";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "Feedback" };

type Props = { params: Promise<{ id: string }> };

/**
 * Turn a user-agent string into the two facts that actually help reproduce a
 * bug: what kind of device, and which browser. Nobody needs the build tokens,
 * and a raw UA string in the UI reads as noise, so the full value stays in
 * the row for the rare case someone wants it.
 */
function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const device = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Macintosh/i.test(ua)
          ? "Mac"
          : /Windows/i.test(ua)
            ? "Windows"
            : null;
  // Order matters: Edge and Chrome both claim Safari, Chrome claims Edge's
  // absence only by omission.
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /CriOS|Chrome/i.test(ua)
      ? "Chrome"
      : /Firefox|FxiOS/i.test(ua)
        ? "Firefox"
        : /Safari/i.test(ua)
          ? "Safari"
          : null;
  const parts = [device, browser].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

export default async function FeedbackDetailPage({ params }: Props) {
  const { id } = await params;
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data: item } = (await supabase
    .from("feedback_items" as never)
    .select(
      `id, kind, title, body, status, page_context, app_version, user_agent,
       created_by, created_at`,
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      kind: string;
      title: string;
      body: string | null;
      status: string;
      page_context: string | null;
      app_version: string | null;
      user_agent: string | null;
      created_by: string | null;
      created_at: string;
    } | null;
  };

  // RLS already hides other people's items from an employee, so "not visible"
  // and "not there" are the same answer here.
  if (!item) notFound();

  const { data: replies } = (await supabase
    .from("feedback_replies" as never)
    .select("id, body, created_by, created_at")
    .eq("feedback_item_id", id)
    .order("created_at", { ascending: true })) as unknown as {
    data: Array<{
      id: string;
      body: string;
      created_by: string | null;
      created_at: string;
    }> | null;
  };

  const authorIds = Array.from(
    new Set(
      [item.created_by, ...(replies ?? []).map((r) => r.created_by)].filter(
        (v): v is string => !!v,
      ),
    ),
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

  const nameOf = (mid: string | null) =>
    (mid ? names.get(mid) : null) ?? "Someone";

  const device = describeDevice(item.user_agent);
  const canMoveStatus = ["owner", "admin", "manager"].includes(membership.role);

  return (
    <PageShell
      title={item.title}
      description={`${feedbackKindLabel(item.kind)} · reported by ${nameOf(
        item.created_by,
      )} on ${format(new Date(item.created_at), "MMM d 'at' h:mm a")}`}
      actions={
        <StatusBadge tone={feedbackStatusTone(item.status as FeedbackStatus)}>
          {feedbackStatusLabel(item.status)}
        </StatusBadge>
      }
    >
      <div className="max-w-3xl space-y-6">
        <Link
          href="/app/feedback"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All feedback
        </Link>

        <div className="rounded-lg border border-border bg-card p-4">
          {item.body ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {item.body}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No extra detail was added.
            </p>
          )}

          {(item.page_context || item.app_version || device) && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3">
              {item.page_context && <Chip>Page: {item.page_context}</Chip>}
              {item.app_version && <Chip>Build: {item.app_version}</Chip>}
              {device && <Chip>{device}</Chip>}
            </div>
          )}
        </div>

        {(replies ?? []).length > 0 && (
          <div className="space-y-3">
            {(replies ?? []).map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {nameOf(r.created_by)} ·{" "}
                  {format(new Date(r.created_at), "MMM d 'at' h:mm a")}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {r.body}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-4">
          <ReplyForm
            id={item.id}
            currentStatus={item.status as FeedbackStatus}
            canMoveStatus={canMoveStatus}
          />
        </div>
      </div>
    </PageShell>
  );
}
