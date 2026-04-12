"use client";

import { useEffect, useState } from "react";
import { Check, Download, Smartphone, Share } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !("MSStream" in window)
  );
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as unknown as { standalone: boolean }).standalone)
  );
}

/**
 * Self-contained PWA install card for the Settings page.
 *
 * - Android/Chrome: one-click native install prompt
 * - iOS Safari: step-by-step instructions (Apple doesn't support the prompt API)
 * - Already installed: shows a green confirmation
 */
export function PwaInstallCard() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    if (isIOS()) {
      setIos(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Detect post-install
    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
    }
    setDeferredPrompt(null);
    setInstalling(false);
  }

  // Already installed
  if (installed) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-green-500/20 bg-green-500/5 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-green-500/10">
          <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">App installed</span>
          <span className="text-xs text-muted-foreground">
            Sollos is on your home screen. Open it from there for the best experience.
          </span>
        </div>
      </div>
    );
  }

  // iOS — can't trigger install, show instructions
  if (ios) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div>
            <span className="text-sm font-medium block">Install on iPhone</span>
            <span className="text-xs text-muted-foreground">
              Add Sollos to your home screen for quick access.
            </span>
          </div>
        </div>

        <ol className="space-y-3 ml-1">
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              1
            </span>
            <span className="text-sm text-muted-foreground pt-0.5">
              Tap the{" "}
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                <Share className="h-3 w-3" /> Share
              </span>{" "}
              button at the bottom of Safari
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              2
            </span>
            <span className="text-sm text-muted-foreground pt-0.5">
              Scroll down and tap{" "}
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                Add to Home Screen
              </span>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              3
            </span>
            <span className="text-sm text-muted-foreground pt-0.5">
              Tap{" "}
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                Add
              </span>{" "}
              — done! Open Sollos from your home screen.
            </span>
          </li>
        </ol>
      </div>
    );
  }

  // Android / Chrome — one-click install
  if (deferredPrompt) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">Install Sollos app</span>
          <span className="text-xs text-muted-foreground">
            Add to your home screen for quick, full-screen access.
          </span>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {installing ? "Installing…" : "Install"}
        </button>
      </div>
    );
  }

  // Desktop or unsupported browser — generic instructions
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
        <Smartphone className="h-5 w-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">Install Sollos app</span>
        <span className="text-xs text-muted-foreground">
          Open this page on your phone in Chrome (Android) or Safari (iPhone) to install.
        </span>
      </div>
    </div>
  );
}
