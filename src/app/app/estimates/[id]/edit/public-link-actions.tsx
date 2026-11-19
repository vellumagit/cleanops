"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { ensureEstimatePublicTokenAction } from "../../actions";
import Link from "next/link";
import { Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Estimate-edit-page convenience actions for the public shareable
 * link. Mirrors the "View public link" button on the invoice detail
 * page — but adds a one-click copy because owners often want the URL
 * to paste into a text/email without opening it first.
 *
 * The PDF workflow: click View → the branded public estimate page
 * opens in a new tab → click Print / Save PDF on that page →
 * browser print dialog yields a clean, branded PDF.
 */
export function PublicLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Public estimate link copied.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy — select the URL and copy manually.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "default", size: "sm" })}
      >
        <ExternalLink className="h-4 w-4" />
        View client page
      </Link>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </>
        )}
      </button>
    </div>
  );
}

/**
 * For an estimate that has no client link yet (never sent, never
 * downloaded): make one, so the link can be copied and shared without
 * emailing the estimate or opening its PDF first.
 */
export function CreatePublicLinkButton({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await ensureEstimatePublicTokenAction(estimateId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("Client link created. It is valid for 30 days.");
          router.refresh();
        })
      }
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
      {pending ? "Creating…" : "Create client link"}
    </button>
  );
}
