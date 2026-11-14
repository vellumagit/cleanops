"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { REFUSAL_REPEAT_MS, refusalMessage } from "@/lib/refusal-log";

/**
 * Remembers what the app tells the person when it says no.
 *
 * Mounted once in the office shell and once in the field shell. It keeps
 * the words of every red toast and every error box (`role="alert"`) the
 * person is shown, with the screen they were on, and posts them to
 * /api/refusals. It changes nothing on screen and shows nothing itself.
 *
 * Why here and not in the server actions: there are a few hundred of them
 * returning errors in half a dozen shapes, and what matters is what the
 * person actually SAW, including messages made in the browser. Two places
 * show an error in this app, a toast and an alert box, and this watches
 * both.
 *
 * On 2026-11-14 an owner was refused all afternoon by two rules with
 * unhelpful messages. Nothing had kept what she was shown; it was pieced
 * together from request times and guessed. With this, it is a query.
 */
export function RefusalRecorder() {
  useEffect(() => {
    const queue: Array<{ message: string; path: string; kind: "toast" | "alert" }> = [];
    const lastSeen = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const items = queue.splice(0, queue.length);
      if (items.length === 0) return;
      // keepalive: the next thing a refused person often does is leave.
      fetch("/api/refusals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        keepalive: true,
      }).catch(() => {
        // Nothing to do, and nothing to show.
      });
    };

    const note = (text: unknown, kind: "toast" | "alert") => {
      const message = refusalMessage(text);
      if (!message) return;
      const path = window.location.pathname;
      const key = `${path}|${message}`;
      const now = Date.now();
      // The same words from the same screen inside a few seconds is one
      // event drawn twice (a toast and its box, a re-render). After that, a
      // repeat is the person trying again, which is the signal.
      if (now - (lastSeen.get(key) ?? 0) < REFUSAL_REPEAT_MS) return;
      lastSeen.set(key, now);
      queue.push({ message, path, kind });
      if (!timer) timer = setTimeout(flush, 800);
    };

    // 1. Red toasts. `toast` is one shared object, so wrapping its `error`
    // here covers every caller in the app.
    const original = toast.error;
    const wrapped = ((message: unknown, ...rest: unknown[]) => {
      try {
        if (typeof message === "string") note(message, "toast");
      } catch {
        // Recording must never be the reason a message is not shown.
      }
      return (original as (...args: unknown[]) => unknown)(message, ...rest);
    }) as typeof toast.error;
    toast.error = wrapped;

    // 2. Error boxes. Every one in the app is `role="alert"`; they appear
    // (or change their words) after a save comes back.
    const seenBoxes = new WeakMap<Element, string>();
    const look = (root: ParentNode | Element) => {
      const boxes: Element[] = [];
      if (root instanceof Element && root.matches('[role="alert"]')) boxes.push(root);
      root.querySelectorAll?.('[role="alert"]').forEach((el) => boxes.push(el));
      for (const el of boxes) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text || seenBoxes.get(el) === text) continue;
        seenBoxes.set(el, text);
        note(text, "alert");
      }
    };
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "characterData") {
          const el = m.target.parentElement?.closest('[role="alert"]');
          if (el) look(el);
          continue;
        }
        m.addedNodes.forEach((n) => {
          if (n instanceof Element) look(n);
          else if (n.parentElement) {
            const el = n.parentElement.closest('[role="alert"]');
            if (el) look(el);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // 3. Trying again. A second save that fails the same way leaves the
    // same box with the same words, so nothing in the page changes and the
    // watcher above stays quiet. But the person tried twice, and how many
    // times is the part worth knowing (the owner's three attempts in 17
    // seconds on 2026-11-14 would have read as one). So: after any form is
    // submitted, look at the error boxes still showing in it (or in the
    // dialog around it) once the save has had time to come back.
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const onSubmit = (event: Event) => {
      const form = event.target instanceof Element ? event.target : null;
      const scope = form?.closest('[role="dialog"]') ?? form;
      if (!scope) return;
      for (const wait of [1500, 4000]) {
        const t = setTimeout(() => {
          pending.delete(t);
          if (!scope.isConnected) return;
          scope.querySelectorAll('[role="alert"]').forEach((el) => {
            const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
            // note() ignores the same words inside a few seconds, so the two
            // looks and the watcher above count one failure once.
            if (text) note(text, "alert");
          });
        }, wait);
        pending.add(t);
      }
    };
    document.addEventListener("submit", onSubmit, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("submit", onSubmit, true);
      for (const t of pending) clearTimeout(t);
      if (toast.error === wrapped) toast.error = original;
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
  }, []);

  return null;
}
