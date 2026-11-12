import Link from "next/link";
import { MessageSquareReply, Phone, ImageIcon } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { formatDateTime } from "@/lib/format";
import { phoneKey } from "@/lib/sms-inbound";
import { displayPhone, senderDirectory, senderHref, type Sender } from "@/lib/sms-inbound-reply";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Text replies" };

/** How far back the page reads. Older replies stay in the table. */
const DAYS = 90;
const LIMIT = 300;

/**
 * Every text someone sent back to the company's number (2026-11-12).
 *
 * Replies were already saved and put in front of the office as a
 * notification (lib/sms-inbound-reply.ts), but a notification scrolls away
 * and quotes one message at a time. This is where they can be read later, in
 * full, with who sent them. Reading only: a reply goes out from the office's
 * own phone, through the link on each row, so nothing here texts anyone.
 *
 * Owners, admins and managers: the same people the replies are sent to, and
 * the only roles the sms_messages policy lets read the table.
 */
export default async function TextRepliesPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  // Server component, rendered per request: the clock is read once here.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const [{ data: rows }, tz, org] = await Promise.all([
    supabase
      .from("sms_messages" as never)
      .select("id, from_number, body, created_at")
      .eq("organization_id", membership.organization_id)
      .eq("direction", "inbound")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(LIMIT) as unknown as Promise<{
      data: Array<{ id: string; from_number: string | null; body: string; created_at: string }> | null;
    }>,
    getOrgTimezone(membership.organization_id),
    supabase
      .from("organizations")
      .select("sms_from_number")
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as Promise<{ data: { sms_from_number: string | null } | null }>,
  ]);

  const replies = rows ?? [];
  // Names from the people on file now, so a client added after they texted
  // still shows by name. Read once, through the server's key: team members'
  // phone numbers are not readable to a manager row by row.
  const directory: Map<string, Sender> =
    replies.length > 0 ? await senderDirectory(createSupabaseAdminClient(), membership.organization_id) : new Map();
  const hasNumber = Boolean(org.data?.sms_from_number);

  return (
    <PageShell
      title="Text replies"
      description={`What people texted back to your Sollos number in the last ${DAYS} days.`}
    >
      {!hasNumber && (
        <p className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          Texting isn&rsquo;t set up for your company yet, so nobody can reply.{" "}
          {membership.role === "owner" || membership.role === "admin" ? (
            <Link href="/app/settings/sms" className="font-medium text-foreground underline underline-offset-2">
              Set it up in Settings → SMS
            </Link>
          ) : (
            "An owner or admin can set it up in Settings → SMS."
          )}
        </p>
      )}

      {replies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <MessageSquareReply className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No replies yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            When a client, cleaner or freelancer texts back to your number, it shows up here, and owners and
            managers get a notification.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
          {replies.map((r) => {
            const sender = directory.get(phoneKey(r.from_number)) ?? ({ kind: "unknown" } as Sender);
            const number = displayPhone(r.from_number);
            const media = r.body === "[picture or file]";
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium">
                    {sender.kind === "unknown" ? (
                      number
                    ) : (
                      <Link href={senderHref(sender)} className="hover:underline">
                        {sender.name}
                      </Link>
                    )}
                    {sender.kind === "client" && <span className="ml-1.5 text-xs font-normal text-muted-foreground">client</span>}
                    {sender.kind === "freelancer" && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">on-call</span>
                    )}
                    {sender.kind === "member" && <span className="ml-1.5 text-xs font-normal text-muted-foreground">team</span>}
                  </p>
                  <time dateTime={r.created_at} className="text-xs text-muted-foreground">
                    {formatDateTime(r.created_at, tz)}
                  </time>
                </div>
                {media ? (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Sent a picture or file (open it in Twilio)
                  </p>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.body}</p>
                )}
                {r.from_number && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {sender.kind !== "unknown" && <span>{number}</span>}
                    <a href={`sms:${r.from_number}`} className="inline-flex items-center gap-1 hover:text-foreground">
                      <MessageSquareReply className="h-3 w-3" />
                      Text back
                    </a>
                    <a href={`tel:${r.from_number}`} className="inline-flex items-center gap-1 hover:text-foreground">
                      <Phone className="h-3 w-3" />
                      Call
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {replies.length === LIMIT && (
        <p className="mt-3 text-xs text-muted-foreground">Showing the latest {LIMIT}.</p>
      )}
    </PageShell>
  );
}
