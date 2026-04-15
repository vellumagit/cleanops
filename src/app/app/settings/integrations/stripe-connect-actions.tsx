"use client";

import { useTransition } from "react";
import { Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

export function StripeDisconnectButton() {
  const [isPending, startTransition] = useTransition();
  function onClick() {
    if (!confirm("Disconnect Stripe? You'll stop being able to accept card payments until you reconnect.")) {
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/integrations/stripe/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Could not disconnect");
        return;
      }
      window.location.reload();
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      Disconnect
    </button>
  );
}
