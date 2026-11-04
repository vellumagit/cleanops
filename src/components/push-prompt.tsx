"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Why this device can't turn push on, or null when it can.
 *
 * The toggle used to show "Notifications off (tap to enable)" on every
 * device and fail silently on the ones that can't: an iPhone in a Safari tab
 * has a service worker but no PushManager (Apple only allows web push from
 * the home-screen app), so the tap threw inside a try/catch and nothing
 * happened. A phone where notifications were once blocked got the same dead
 * button, because requestPermission() answers "denied" without asking again.
 * Each case now says what to do instead.
 */
type Blocker = "ios_browser" | "unsupported" | "denied" | null;

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function pushBlocker(): Blocker {
  const supported =
    !!VAPID_PUBLIC &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (!supported) return isIOS() && !isStandalone() ? "ios_browser" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return null;
}

function blockerText(b: Exclude<Blocker, null>): string {
  switch (b) {
    case "ios_browser":
      return "On iPhone, notifications only work from the home-screen app. In Safari tap Share, then Add to Home Screen, open Sollos from the new icon, and turn them on there.";
    case "denied":
      // Android was read the desktop wording on 2026-11-03 and nobody on the
      // call knew where "site settings" was. An installed app has no address
      // bar at all, so each case names the actual screens.
      if (isIOS())
        return "Notifications are blocked for Sollos on this phone. Open Settings, then Notifications, then Sollos, and allow them. Then come back here.";
      if (isAndroid())
        return isStandalone()
          ? "Notifications are blocked for Sollos on this phone. Press and hold the Sollos icon on your home screen, tap App info, then Notifications, and turn them on. Then come back here and tap again."
          : "Notifications are blocked for Sollos in Chrome. Tap the icon to the left of the web address, then Permissions, then Notifications, and choose Allow. Then reload this page.";
      return "Notifications are blocked for Sollos in this browser. Click the icon to the left of the web address, allow Notifications, then reload this page.";
    case "unsupported":
      return "This browser can't receive notifications. Open Sollos in Chrome, Safari or Edge instead.";
  }
}

/** A service worker that is registered and active, registering it if needed. */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register("/sw.js");
  }
  // ready never rejects; bound it so a stuck worker reads as an error, not
  // a button that says "Enabling..." forever.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error("The app's background worker didn't start. Close Sollos fully and open it again."),
          ),
        10_000,
      ),
    ),
  ]);
}

/**
 * Ask, subscribe, and store. Throws an Error whose message is fit to show.
 * Returns "denied" when the person said no (or dismissed the question).
 */
async function enablePush(
  membershipId: string,
  organizationId: string,
): Promise<"granted" | "denied"> {
  // First thing in the tap handler: Safari only shows the question when it
  // is asked directly from a tap.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = await readyRegistration();
  let subscription: PushSubscription;
  try {
    subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`This device's push service refused: ${msg}`);
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), membershipId, organizationId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      res.status === 401
        ? "You've been signed out. Sign in again, then try."
        : `Couldn't save it (${body?.error ?? res.status}).`,
    );
  }
  return "granted";
}

type PushState = "loading" | "blocked" | "prompt" | "subscribing" | "subscribed" | "dismissed";

/**
 * Inline banner asking to enable notifications. Renders nothing while
 * loading, once subscribed or dismissed this session, and on devices that
 * can't do push (the profile toggle explains those).
 */
export function PushPrompt({
  membershipId,
  organizationId,
}: {
  membershipId: string;
  organizationId: string;
}) {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pushBlocker()) {
      // Browser-only check, so it runs after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("blocked");
      return;
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setState(sub ? "subscribed" : "prompt");
      })
      .catch(() => {
        if (!cancelled) setState("prompt");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setState("subscribing");
    setError(null);
    try {
      const r = await enablePush(membershipId, organizationId);
      if (r === "granted") setState("subscribed");
      else setState(Notification.permission === "denied" ? "blocked" : "prompt");
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("prompt");
    }
  }, [membershipId, organizationId]);

  if (state !== "prompt" && state !== "subscribing") return null;

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
      <Bell className="h-5 w-5 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">Enable notifications</p>
        <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-300">
          {error ?? "Get alerts for new jobs, messages, and schedule changes."}
        </p>
      </div>
      <button
        type="button"
        onClick={subscribe}
        disabled={state === "subscribing"}
        className="shrink-0 touch-manipulation rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {state === "subscribing" ? "Enabling..." : error ? "Try again" : "Turn on"}
      </button>
      <button
        type="button"
        onClick={() => setState("dismissed")}
        className="shrink-0 touch-manipulation rounded-full p-1 text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Push status for the profile page: on, off with a working button, or the
 * reason this device can't and what to do about it.
 *
 * Starts as "loading" on both server and client so the first render matches.
 * It used to resolve during the client's first render, which differed from
 * the server's HTML and made React throw the markup away.
 */
export function PushToggle({
  membershipId,
  organizationId,
}: {
  membershipId: string;
  organizationId: string;
}) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [blocker, setBlocker] = useState<Blocker>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const b = pushBlocker();
    if (b) {
      // Browser-only check, so it runs after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlocker(b);
      setSubscribed(false);
      return;
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setSubscribed(!!sub);
      })
      .catch(() => {
        if (!cancelled) setSubscribed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        const reg = await readyRegistration();
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          const endpoint = existing.endpoint;
          await existing.unsubscribe();
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          });
        }
        setSubscribed(false);
      } else {
        const r = await enablePush(membershipId, organizationId);
        if (r === "granted") setSubscribed(true);
        else if (Notification.permission === "denied") setBlocker("denied");
      }
    } catch (err) {
      console.error("[push] toggle failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
    setBusy(false);
  }, [membershipId, organizationId, subscribed]);

  if (subscribed === null) return null;

  if (blocker) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="text-xs leading-relaxed">{blockerText(blocker)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex touch-manipulation items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-50"
      >
        {busy ? (
          <span>Working…</span>
        ) : subscribed ? (
          <>
            <Bell className="h-4 w-4 text-emerald-600" />
            <span>Notifications on</span>
            <span className="text-xs text-muted-foreground">(tap to disable)</span>
          </>
        ) : (
          <>
            <BellOff className="h-4 w-4 text-muted-foreground" />
            <span>Notifications off</span>
            <span className="text-xs text-muted-foreground">(tap to enable)</span>
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const clean = base64String.trim();
  const padding = "=".repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
