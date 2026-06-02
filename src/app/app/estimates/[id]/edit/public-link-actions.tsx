"use client";

import { useState } from "react";
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
        View public link / Save as PDF
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
