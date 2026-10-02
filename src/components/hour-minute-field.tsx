"use client";

import { useState } from "react";

/**
 * An hours + minutes pair that reports total minutes.
 *
 * The strings are the state, not the number. Rendering `value={minutes % 60}`
 * looks equivalent and is not: React only rewrites the DOM when the VALUE IT
 * RENDERED changes, so as soon as what you type parses back to the number
 * already in state the field keeps whatever text is in it. Typing into a field
 * showing "0" then left you looking at "050" — the state was correct at 50 all
 * along, but React had no reason to touch the DOM, so the stale text stayed.
 * (Same bug the main Duration field hit; components/duration-input.tsx solved
 * it the same way.)
 *
 * Holding the raw string fixes it: an empty field is "" and shows the
 * placeholder, so there is no literal 0 sitting there to type in front of.
 *
 * Initialised once from `valueMinutes`, exactly like DurationInput's
 * `defaultMinutes`. The parent owns the canonical number and must remount this
 * (change its key) to force a reset — nothing in the segment editor mutates a
 * row's minutes except these fields, and adding a row mounts a fresh one.
 */
export function HourMinuteField({
  label,
  ariaPrefix,
  valueMinutes,
  onChangeMinutes,
}: {
  label: string;
  ariaPrefix: string;
  valueMinutes: number;
  onChangeMinutes: (minutes: number) => void;
}) {
  const [hours, setHours] = useState<string>(
    valueMinutes > 0 ? String(Math.floor(valueMinutes / 60)) : "",
  );
  const [mins, setMins] = useState<string>(
    valueMinutes % 60 > 0 ? String(valueMinutes % 60) : "",
  );

  const toInt = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };

  function emit(nextHours: string, nextMins: string) {
    onChangeMinutes(toInt(nextHours) * 60 + toInt(nextMins));
  }

  // Typing 90 in the minutes box should mean 1h 30m, not be clamped away.
  // Rolling over on blur rather than per keystroke lets "90" exist while it
  // is still being typed.
  function normalize() {
    const m = toInt(mins);
    if (m >= 60) {
      const h = toInt(hours) + Math.floor(m / 60);
      setHours(String(h));
      setMins(String(m % 60));
      onChangeMinutes(h * 60 + (m % 60));
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          placeholder="0"
          aria-label={`${ariaPrefix} hours`}
          value={hours}
          onChange={(e) => {
            setHours(e.target.value);
            emit(e.target.value, mins);
          }}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
        />
        <span className="shrink-0 text-xs text-muted-foreground">hr</span>
        <input
          type="number"
          min={0}
          max={999}
          step={5}
          inputMode="numeric"
          placeholder="0"
          aria-label={`${ariaPrefix} minutes`}
          value={mins}
          onChange={(e) => {
            setMins(e.target.value);
            emit(hours, e.target.value);
          }}
          onBlur={normalize}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
        />
        <span className="shrink-0 text-xs text-muted-foreground">min</span>
      </div>
    </div>
  );
}
