"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, explicit-render mode. Managed: most people never
 * see more than a brief checkmark. Renders nothing when no site key is
 * configured, so the form is unchanged on environments without one.
 *
 * The widget writes its token into a hidden `cf-turnstile-response` input
 * inside the enclosing form; the server action reads that and verifies it
 * with Cloudflare. The widget alone proves nothing.
 */
interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __sollosTurnstileReady?: () => void;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__sollosTurnstileReady&render=explicit";

export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken?: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // The callback lives in a ref so a new identity per render doesn't tear
  // the widget down and re-run the challenge; updated in an effect, never
  // during render.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => onTokenRef.current?.(token),
        "expired-callback": () => onTokenRef.current?.(null),
        "error-callback": () => onTokenRef.current?.(null),
      });
    };
    if (window.turnstile) {
      render();
    } else {
      window.__sollosTurnstileReady = render;
      if (!document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile"]')) {
        const script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
    }
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
