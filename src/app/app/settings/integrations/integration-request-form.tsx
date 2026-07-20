"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { requestIntegrationAction } from "./request-actions";

/**
 * A small "want a specific integration / webhook help?" prompt that expands
 * into a short message form and emails support@sollos3.com.
 */
export function IntegrationRequestForm() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!message.trim()) {
      toast.error("Add a short message first.");
      return;
    }
    const fd = new FormData();
    fd.set("message", message);
    startTransition(async () => {
      const res = await requestIntegrationAction(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't send — please try again.");
        return;
      }
      toast.success("Thanks — we'll be in touch by email.");
      setMessage("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <p className="pt-2 text-center text-xs text-muted-foreground">
        Want to see a specific integration here, or need help with webhooks?{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        >
          Reach out
        </button>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium">Request an integration</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Tell us what you&apos;d like to connect, or ask about webhooks — we&apos;ll
        email you back.
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="e.g. Outlook Calendar sync, Slack alerts, Zapier / webhooks…"
        className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={buttonVariants({ size: "sm" })}
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
