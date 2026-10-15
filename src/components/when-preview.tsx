"use client";

import * as React from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * The chosen moment, spelled out under a date picker.
 *
 * On Android a native <input type="date"> reads "2026-10-19" and the picker
 * gives no weekday; iOS shows one. We don't fight the native control. We
 * write the chosen moment out in words directly under every date-bearing
 * input the instant it has a value:
 *
 *   Monday, October 19, 2026 · 2:30 PM
 *
 * It is pure wall-clock formatting of the digits the picker produced — no
 * timezone math, no Date-from-local-string parsing — so it reads identically
 * on Android, iPhone and desktop. Nothing renders while the field is blank,
 * so optional dates don't add an empty row.
 *
 * Ported from soul-service-app's WhenPreview on 2026-10-14. The booking
 * form's "Scheduled at" keeps its own DayGlanceField (weekday PLUS what is
 * already booked that day) and does not use this.
 */

/** "2026-09-14" → "Monday, September 14, 2026";
 *  "2026-09-14T19:30" → "Monday, September 14, 2026 · 7:30 PM"; else "". */
export function readableWall(local: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local ?? "");
  if (!m) return "";
  const [, y, mo, d, h, mi] = m;
  const hasTime = h !== undefined;
  const date = new Date(
    Date.UTC(+y, +mo - 1, +d, hasTime ? +h : 12, hasTime ? +mi : 0),
  );
  if (Number.isNaN(date.getTime())) return "";
  // The digits were typed as a calendar day; UTC getters read them back
  // unchanged. (Date.UTC also normalises "2026-02-31" to March 3 — a typed
  // impossible date reads as the day it rolls to, which is still truthful.)
  const day = date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  if (!hasTime) return day;
  const time = date.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/** The spelled-out line under a picker. Nothing while blank. */
export function WhenPreview({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const text = readableWall(value);
  if (!text) return null;
  return (
    <div
      className={`mt-1 text-[11px] text-muted-foreground ${className}`}
      aria-live="polite"
    >
      {text}
    </div>
  );
}

type DateLikeProps = Omit<React.ComponentProps<typeof Input>, "type">;

/**
 * Both wrappers work uncontrolled (name + defaultValue) and controlled
 * (value + onChange): the preview mirrors whichever the caller uses.
 */
function withPreview(type: "date" | "datetime-local") {
  function Wrapped({ defaultValue, value, onChange, ...rest }: DateLikeProps) {
    const [typed, setTyped] = useState(
      typeof defaultValue === "string" ? defaultValue : "",
    );
    const shown = typeof value === "string" ? value : typed;
    return (
      <div className="min-w-0">
        <Input
          {...rest}
          type={type}
          defaultValue={defaultValue}
          value={value}
          onChange={(e) => {
            setTyped(e.target.value);
            onChange?.(e);
          }}
        />
        <WhenPreview value={shown} />
      </div>
    );
  }
  Wrapped.displayName = type === "date" ? "DateInput" : "DateTimeInput";
  return Wrapped;
}

/** Drop-in for <Input type="date">; the weekday appears underneath. */
export const DateInput = withPreview("date");

/** Drop-in for <Input type="datetime-local">; weekday and time underneath. */
export const DateTimeInput = withPreview("datetime-local");
