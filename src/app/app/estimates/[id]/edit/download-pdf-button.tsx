"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ensureEstimatePublicTokenAction } from "../../actions";

/**
 * "Download PDF" button on the estimate edit page.
 *
 * Two-step flow:
 *   1. Ensure the estimate has a public_token (mint one if missing).
 *      This is what makes the button work even on estimates that
 *      were never Sent — you can generate a PDF for your own records
 *      without emailing the customer.
 *   2. Open /api/e/[token]/pdf in a new tab. The route renders the
 *      branded public estimate page via headless Chromium and streams
 *      the PDF back inline — the browser shows it in a tab with its
 *      own save/download controls.
 *
 * Cold-start latency on the API route is 2–5s on Vercel the first
 * time per region (Chromium spin-up). The button shows a spinner
 * during the token mint; the slow part happens in the new tab and
 * is visible there.
 */
export function DownloadPdfButton({
  estimateId,
  initialToken,
}: {
  estimateId: string;
  initialToken: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState<string | null>(initialToken);

  const handleClick = () => {
    // Fast path: token already present, just open the PDF URL.
    if (token) {
      window.open(`/api/e/${token}/pdf`, "_blank", "noopener,noreferrer");
      return;
    }

    // Slow path: mint a token first, then open the URL. We can't
    // window.open inside an async callback after the user gesture
    // (popup blockers), so we open a blank tab synchronously and
    // navigate it once the token is ready.
    const newTab = window.open("about:blank", "_blank", "noopener,noreferrer");

    startTransition(async () => {
      const result = await ensureEstimatePublicTokenAction(estimateId);
      if (!result.ok) {
        toast.error(result.error);
        newTab?.close();
        return;
      }
      setToken(result.token);
      if (newTab) {
        newTab.location.href = `/api/e/${result.token}/pdf`;
      } else {
        // Popup was blocked — fall back to same-tab navigation.
        window.location.href = `/api/e/${result.token}/pdf`;
      }
    });
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={pending}
      size="sm"
      variant="default"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileText className="h-4 w-4" />
      )}
      {pending ? "Preparing…" : "Download PDF"}
    </Button>
  );
}
