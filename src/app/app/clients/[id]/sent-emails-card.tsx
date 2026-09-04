import { Mail, Paperclip } from "lucide-react";

export type SentEmail = {
  id: string;
  subject: string;
  to_email: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
  attachments: Array<{ name: string }>;
  sender_name: string | null;
};

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * The sent folder for one client: everything the office wrote to them
 * by hand, newest first. Automated mail (invoices, reminders) is not
 * here on purpose; it has its own trail on the thing that sent it.
 */
export function SentEmailsCard({
  emails,
  timeZone,
  canCompose,
}: {
  emails: SentEmail[];
  timeZone: string;
  /** False when the Email client button isn't on the page (no address). */
  canCompose: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Sent emails</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Messages written to this client from Sollos, with what was
          attached.
        </p>
      </header>
      {emails.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">
          {canCompose ? (
            <>
              Nothing sent yet. Use{" "}
              <span className="font-medium">Email client</span> at the top of
              the page.
            </>
          ) : (
            "Nothing sent yet. Add an email address to this client to write to them from here."
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {emails.map((e) => (
            <li key={e.id} className="flex gap-3 px-5 py-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="truncate text-sm font-medium">{e.subject}</p>
                  <p className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {formatWhen(e.created_at, timeZone)}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  To {e.to_email}
                  {e.sender_name ? ` · by ${e.sender_name}` : ""}
                </p>
                {e.attachments.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {e.attachments.map((a, i) => (
                      <span
                        key={`${a.name}-${i}`}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
                      >
                        <Paperclip className="h-3 w-3" />
                        {a.name}
                      </span>
                    ))}
                  </p>
                )}
                {e.status === "failed" && (
                  <p className="mt-1 text-[11px] font-medium text-destructive">
                    Didn&rsquo;t send{e.error ? `: ${e.error}` : "."}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
