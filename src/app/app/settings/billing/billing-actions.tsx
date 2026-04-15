"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "sonner";

export function ManageInStripeButton() {
  const [isPending, startTransition] = useTransition();
  function onClick() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/stripe/portal", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? "Could not open billing portal");
          return;
        }
        const { url } = await res.json();
        window.location.href = url;
      } catch {
        toast.error("Network error");
      }
    });
  }
  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
      )}
      Manage in Stripe
    </Button>
  );
}

export function SubscribeButton({
  plan,
  label,
  variant = "default",
}: {
  plan: "starter" | "growth";
  label: string;
  variant?: "default" | "outline";
}) {
  const [loading, setLoading] = useState(false);
  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Could not start checkout");
        setLoading(false);
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      toast.error("Network error");
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={buttonVariants({ size: "sm", variant })}
    >
      {loading ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : null}
      {label}
    </button>
  );
}
