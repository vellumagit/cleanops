"use client";

import { useEffect, useState } from "react";
import { Check, Download, Smartphone, Share, SquarePlus } from "lucide-react";

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

function isSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Self-contained PWA install card for the Settings page.
 *
 * - Android/Chrome: one-click native install prompt
 * - iOS Safari: step-by-step instructions
 * - iOS non-Safari: tells user to open in Safari first
 * - Already installed: shows a green confirmation
 */
export function PwaInstallCard() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  // All three resolve synchronously on mount and never change after that
  // (UA + display-mode are stable for the component's lifetime), so we
  // compute them in the initializer instead of setState-in-effect.
  const [installed, setInstalled] = useState(() =>
    typeof window !== "undefined" && isStandalone(),
  );
  const [ios] = useState(() => typeof window !== "undefined" && isIOS());
  const [inSafari] = useState(
    () => typeof window !== "undefined" && isSafari(),
  );
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (installed) return;

    const beforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

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
      <div className="flex items-center gap-4 rounded-xl border border-green-500/20 bg-green-500/5 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-green-500/10">
          <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">App installed</span>
          <span className="text-xs text-muted-foreground">
            Sollos is on your home screen. Open it from there for the best
            experience.
          </span>
        </div>
      </div>
    );
  }

  // iOS but NOT in Safari — tell them to open in Safari first
  if (ios && !inSafari) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Smartphone className="h-6 w-6 text-primary" />
          </div>
          <div>
            <span className="text-base font-semibold block">
              Install Sollos
            </span>
            <span className="text-sm text-muted-foreground">
              Open this page in <strong>Safari</strong> to install.
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          iPhone only lets you install apps from Safari. Copy this URL and paste
          it into Safari, then come back to this page.
        </div>
      </div>
    );
  }

  // iOS in Safari — show clear step-by-step
  if (ios && inSafari) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Smartphone className="h-6 w-6 text-primary" />
          </div>
          <div>
            <span className="text-base font-semibold block">
              Install on iPhone
            </span>
            <span className="text-sm text-muted-foreground">
              3 taps to add Sollos to your home screen.
            </span>
          </div>
        </div>

        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              1
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-medium text-foreground">
                Tap the Share button
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                It&apos;s the{" "}
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                  <Share className="h-3.5 w-3.5" />
                </span>{" "}
                icon at the bottom of Safari (square with an arrow pointing up).
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              2
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-medium text-foreground">
                Scroll down and tap &quot;Add to Home Screen&quot;
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                You&apos;ll need to{" "}
                <strong>scroll down past the app icons</strong> in the share
                sheet. Look for{" "}
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                  <SquarePlus className="h-3.5 w-3.5" /> Add to Home Screen
                </span>
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              3
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-medium text-foreground">
                Tap &quot;Add&quot; in the top right
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                That&apos;s it — Sollos will appear on your home screen like a
                regular app.
              </p>
            </div>
          </li>
        </ol>

        <div className="mt-4 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
          <strong>Don&apos;t see it?</strong> Make sure you&apos;re using Safari, not
          Chrome or another browser. Only Safari supports home screen apps on
          iPhone.
        </div>
      </div>
    );
  }

  // Android / Chrome — one-click install
  if (deferredPrompt) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
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
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
        <Smartphone className="h-5 w-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">Install Sollos app</span>
        <span className="text-xs text-muted-foreground">
          Open this page on your phone in Chrome (Android) or Safari (iPhone) to
          install.
        </span>
      </div>
    </div>
  );
}
