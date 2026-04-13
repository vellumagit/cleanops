"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type PushState =
  | "loading"
  | "unsupported"
  | "denied"
  | "prompt"       // Permission not yet requested
  | "subscribing"
  | "subscribed"
  | "dismissed";   // User closed the prompt this session

/**
 * Inline push notification prompt.
 *
 * Shows a banner asking the user to enable notifications. Once granted,
 * registers the service worker push subscription and posts it to the API.
 *
 * Renders nothing if:
 *   - Browser doesn't support Push API
 *   - Already subscribed
 *   - Permission denied
 *   - VAPID key not configured
 *   - User dismissed this session
 */
export function PushPrompt({
  membershipId,
  organizationId,
}: {
  membershipId: string;
  organizationId: string;
}) {
  const [state, setState] = useState<PushState>("loading");

  useEffect(() => {
    if (!VAPID_PUBLIC) {
      setState("unsupported");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    const perm = Notification.permission;
    if (perm === "denied") {
      setState("denied");
      return;
    }

    // Check if already subscribed
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setState(sub ? "subscribed" : "prompt");
      })
      .catch(() => setState("prompt"));
  }, []);

  const subscribe = useCallback(async () => {
    setState("subscribing");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      });

      // Send to server
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          membershipId,
          organizationId,
        }),
      });

      if (!res.ok) throw new Error("Subscribe API failed");
      setState("subscribed");
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      setState("prompt");
    }
  }, [membershipId, organizationId]);

  // Don't render anything for these states
  if (
    state === "loading" ||
    state === "unsupported" ||
    state === "denied" ||
    state === "subscribed" ||
    state === "dismissed"
  ) {
    return null;
  }

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
      <Bell className="h-5 w-5 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">Enable notifications</p>
        <p className="mt-0.5 text-xs text-blue-600 dark:text-blue-300">
          Get alerts for new jobs, messages, and schedule changes.
        </p>
      </div>
      <button
        onClick={subscribe}
        disabled={state === "subscribing"}
        className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {state === "subscribing" ? "Enabling..." : "Turn on"}
      </button>
      <button
        onClick={() => setState("dismissed")}
        className="shrink-0 rounded-full p-1 text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Small status indicator for settings / profile pages. Shows current
 * push state and lets the user unsubscribe.
 */
export function PushToggle({
  membershipId,
  organizationId,
}: {
  membershipId: string;
  organizationId: string;
}) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      !VAPID_PUBLIC ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setSubscribed(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false));
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();

      if (existing) {
        // Unsubscribe
        const endpoint = existing.endpoint;
        await existing.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        setSubscribed(false);
      } else {
        // Subscribe
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setSubscribed(false);
          setBusy(false);
          return;
        }
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            membershipId,
            organizationId,
          }),
        });
        setSubscribed(true);
      }
    } catch (err) {
      console.error("[push] toggle failed:", err);
    }
    setBusy(false);
  }, [membershipId, organizationId]);

  if (subscribed === null) return null;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-50"
    >
      {subscribed ? (
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
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
