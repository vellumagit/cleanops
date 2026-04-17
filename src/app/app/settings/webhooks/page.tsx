import Link from "next/link";
import { ArrowLeft, Globe, Trash2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  createWebhookAction,
  deleteWebhookAction,
  toggleWebhookAction,
} from "./actions";

export const metadata = { title: "Webhooks" };

type WebhookRow = {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  last_triggered_at: string | null;
  last_status_code: number | null;
};

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: "booking.created", label: "New booking scheduled" },
  { value: "booking.completed", label: "Booking marked complete" },
  { value: "booking.cancelled", label: "Booking cancelled" },
  { value: "invoice.created", label: "Invoice drafted" },
  { value: "invoice.sent", label: "Invoice sent to client" },
  { value: "invoice.paid", label: "Invoice paid" },
  { value: "review.submitted", label: "Client submitted review" },
  { value: "client.created", label: "New client added" },
];

export default async function WebhooksPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data: webhooks } = (await admin
    .from("webhooks" as never)
    .select(
      "id, name, url, secret, events, is_active, created_at, last_triggered_at, last_status_code",
    )
    .eq("organization_id" as never, membership.organization_id as never)
    .order("created_at" as never, { ascending: false })
    .limit(100)) as unknown as { data: WebhookRow[] | null };

  return (
    <PageShell
      title="Webhooks"
      description="Send real-time POST requests to external systems when events occur."
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      {/* Existing webhooks */}
      {(webhooks ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Globe className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No webhooks yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create one below to start receiving event notifications.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(webhooks ?? []).map((wh) => (
            <li
              key={wh.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{wh.name}</span>
                    <StatusBadge tone={wh.is_active ? "green" : "neutral"}>
                      {wh.is_active ? "Active" : "Paused"}
                    </StatusBadge>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {wh.events.length} event{wh.events.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p
                    className="mt-1 max-w-xs truncate text-xs text-muted-foreground"
                    title={wh.url}
                  >
                    {wh.url}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Secret: {wh.secret.slice(0, 8)}…
                  </p>
                  {wh.last_triggered_at && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Last triggered: {formatDateTime(wh.last_triggered_at)}
                      {wh.last_status_code != null && (
                        <span
                          className={
                            wh.last_status_code >= 200 &&
                            wh.last_status_code < 300
                              ? " text-emerald-600 dark:text-emerald-400"
                              : " text-rose-600 dark:text-rose-400"
                          }
                        >
                          {" "}
                          ({wh.last_status_code})
                        </span>
                      )}
                    </p>
                  )}
                  {wh.events.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {wh.events.map((e) => (
                        <span
                          key={e}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-2">
                  {/* Toggle active */}
                  <form action={toggleWebhookAction}>
                    <input type="hidden" name="id" value={wh.id} />
                    <input
                      type="hidden"
                      name="is_active"
                      value={wh.is_active ? "false" : "true"}
                    />
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      pendingLabel={wh.is_active ? "Pausing…" : "Resuming…"}
                    >
                      {wh.is_active ? "Pause" : "Resume"}
                    </SubmitButton>
                  </form>

                  {/* Delete */}
                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="id" value={wh.id} />
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      pendingLabel="Deleting…"
                    >
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create webhook — collapsible */}
      <details className="mt-6 rounded-lg border border-border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-muted/50">
          + Create webhook
        </summary>
        <form action={createWebhookAction} className="border-t border-border p-4">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                required
                placeholder="e.g. Make.com booking trigger"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                URL <span className="text-rose-500">*</span>
              </label>
              <input
                type="url"
                name="url"
                required
                placeholder="https://"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Must start with https://
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium">
                Events <span className="text-rose-500">*</span>
              </label>
              <ul className="space-y-2">
                {EVENT_OPTIONS.map((opt) => (
                  <li key={opt.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`event-${opt.value}`}
                      name="events"
                      value={opt.value}
                      className="h-4 w-4 rounded border-border accent-foreground"
                    />
                    <label
                      htmlFor={`event-${opt.value}`}
                      className="text-sm leading-none"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {opt.value}
                      </span>
                      <span className="ml-2 text-xs">{opt.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <SubmitButton variant="default" size="sm" pendingLabel="Creating…">
              Create webhook
            </SubmitButton>
          </div>
        </form>
      </details>
    </PageShell>
  );
}
