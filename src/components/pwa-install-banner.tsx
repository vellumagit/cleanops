"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

/**
 * PWA install banner for the field app.
 *
 * On Android / desktop Chrome: captures the `beforeinstallprompt` event and
 * shows a native install prompt on tap.
 *
 * On iOS Safari: shows manual instructions (iOS doesn't support the install
 * prompt API).
 *
 * The banner is dismissible — stores the dismissal in localStorage so it
 * doesn't nag. Shows again after 7 days.
 */

const DISMISS_KEY = "sollos_pwa_dismissed";
const DISMISS_DAYS = 7;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone)
  );
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default hidden

  useEffect(() => {
    // Already installed as PWA — never show
    if (isStandalone()) return;

    // Check dismissal
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (Date.now() - ts < DISMISS_DAYS * 86400000) return;
    }
    setDismissed(false);

    // Android / Chrome
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS — no event, detect via UA
    if (isIOS()) {
      setShowIOS(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Register service worker on mount
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  if (dismissed || isStandalone()) return null;
  if (!deferredPrompt && !showIOS) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDismissed(true);
    }
    setDeferredPrompt(null);
  }

  return (
    <div className="mx-4 mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Download className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">
          Install Sollos
        </p>
        {showIOS ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tap{" "}
            <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 font-medium">
              Share
            </span>{" "}
            then{" "}
            <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 font-medium">
              Add to Home Screen
            </span>{" "}
            to install.
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add to your home screen for quick access.
            </p>
            <Button
              size="sm"
              className="mt-2"
              onClick={handleInstall}
            >
              Install app
            </Button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
