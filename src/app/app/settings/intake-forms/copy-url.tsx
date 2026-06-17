"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — ignore */
          }
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-500" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy
          </>
        )}
      </button>
    </div>
  );
}
