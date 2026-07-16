"use client";

import { useTransition } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { billDownloadUrlAction } from "../actions";

/**
 * Mints a short-lived signed URL for an uploaded invoice and opens it in a
 * new tab. The URL isn't rendered into the page, so it can't leak via HTML.
 */
export function ViewBillButton({ billId }: { billId: string }) {
  const [pending, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      const res = await billDownloadUrlAction(billId);
      if ("url" in res) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={open}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ExternalLink className="h-3.5 w-3.5" />
      )}
      View
    </button>
  );
}
