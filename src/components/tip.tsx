"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Lightbulb } from "lucide-react";
import { tipByKey } from "@/lib/tips";

/**
 * The little lightbulb that teaches the app's fast paths in place.
 *
 * Toggleable (Settings → Tips & shortcuts), ON by default — discoverability
 * is the whole point, and the chips are quiet enough to live with. The
 * preference is per-device (localStorage): a UI-taste setting doesn't
 * deserve a database column.
 */

const STORAGE_KEY = "sollos-tips-enabled";
const EVENT = "sollos-tips-changed";

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useTipsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, () => true);
}

export function setTipsEnabled(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // private mode etc. — the toggle just won't persist
  }
}

/** Inline lightbulb chip. Renders nothing when tips are toggled off. */
export function Tip({ k }: { k: string }) {
  const enabled = useTipsEnabled();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const entry = tipByKey(k);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!enabled || !entry) return null;

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`Tip: ${entry.title}`}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-amber-500/80 transition-colors hover:bg-amber-500/10 hover:text-amber-500"
      >
        <Lightbulb className="h-3 w-3" />
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-50 block w-64 rounded-md border border-border bg-popover p-3 shadow-md">
          <span className="block text-xs font-semibold text-foreground">
            {entry.title}
          </span>
          <span className="mt-1 block text-xs font-normal normal-case leading-relaxed text-muted-foreground">
            {entry.body}
          </span>
        </span>
      )}
    </span>
  );
}

/** The on/off switch, used on the settings page. */
export function TipsToggle() {
  const enabled = useTipsEnabled();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => setTipsEnabled(!enabled)}
      className="inline-flex items-center gap-2"
    >
      <span
        className={
          enabled
            ? "flex h-6 w-10 items-center rounded-full bg-emerald-500 px-0.5 transition-colors"
            : "flex h-6 w-10 items-center rounded-full bg-muted px-0.5 transition-colors"
        }
      >
        <span
          className={
            enabled
              ? "h-5 w-5 translate-x-4 rounded-full bg-white shadow transition-transform"
              : "h-5 w-5 translate-x-0 rounded-full bg-white shadow transition-transform"
          }
        />
      </span>
      <span className="text-sm font-medium">
        {enabled ? "Tips are on" : "Tips are off"}
      </span>
      <span className="text-xs text-muted-foreground">(this device)</span>
    </button>
  );
}
