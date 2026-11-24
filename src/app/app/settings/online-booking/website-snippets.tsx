"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Put it on your website": the two things a company can paste into its own
 * site. The text is made on the server (src/lib/website-embed.ts); this only
 * shows it, previews the button, and copies.
 */
export function WebsiteSnippets({
  live,
  buttonHtml,
  embedHtml,
  button,
}: {
  live: boolean;
  buttonHtml: string;
  embedHtml: string;
  button: { backgroundColor: string; color: string };
}) {
  return (
    <section aria-labelledby="on-your-website" className="space-y-4 rounded-lg border border-border bg-card p-5" data-testid="website-snippets">
      <div>
        <h2 id="on-your-website" className="text-sm font-medium">
          Put it on your website
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Copy one of these into your website. In most website builders it goes in an &ldquo;HTML&rdquo;, &ldquo;Embed&rdquo;
          or &ldquo;Code&rdquo; block. Changes you make here show up on your website by themselves; you paste it once.
        </p>
        {!live && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Your page is a draft, so on your website these show &ldquo;not found&rdquo; until you publish it.
          </p>
        )}
      </div>

      <Snippet
        id="snippet-button"
        title="A button"
        hint="Opens your booking page. Works on every website."
        code={buttonHtml}
        preview={
          <span
            style={{ ...button, display: "inline-block", padding: "14px 28px", borderRadius: 12, font: "600 18px/1.2 system-ui, sans-serif" }}
            aria-hidden="true"
          >
            Book a clean
          </span>
        }
      />
      <Snippet
        id="snippet-embed"
        title="The whole page, on your website"
        hint="Visitors book without leaving your site; it grows to fit. If your website builder won't take it, use the button."
        code={embedHtml}
      />
    </section>
  );
}

function Snippet({ id, title, hint, code, preview }: { id: string; title: string; hint: string; code: string; preview?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The text is on screen to select by hand.
      (document.getElementById(id) as HTMLTextAreaElement | null)?.select();
    }
  }
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-sm font-medium">
            {title}
          </label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {preview && <div className="rounded-md border border-dashed border-border px-4 py-3">{preview}</div>}
      <textarea
        id={id}
        readOnly
        value={code}
        rows={3}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
      />
    </div>
  );
}
