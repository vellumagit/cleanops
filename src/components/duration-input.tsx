"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Duration input: two separate number fields for hours and minutes.
 *
 * Canonical value in the form is still the total minutes — the hidden
 * input submits that. Users stop doing mental math ("wait, 2.5 hours is
 * 150 minutes right?").
 */
export function DurationInput({
  name,
  defaultMinutes = 0,
  required = false,
}: {
  name: string;
  defaultMinutes?: number;
  required?: boolean;
}) {
  const [hours, setHours] = useState<string>(
    defaultMinutes > 0 ? String(Math.floor(defaultMinutes / 60)) : "",
  );
  const [minutes, setMinutes] = useState<string>(
    defaultMinutes > 0 ? String(defaultMinutes % 60) : "",
  );

  const h = Number.isFinite(Number(hours)) ? Math.max(0, Math.floor(Number(hours))) : 0;
  const m = Number.isFinite(Number(minutes)) ? Math.max(0, Math.floor(Number(minutes))) : 0;

  // Normalize minutes ≥ 60 into hours + remainder on blur.
  function normalize() {
    if (m >= 60) {
      const extraHours = Math.floor(m / 60);
      setHours(String(h + extraHours));
      setMinutes(String(m % 60));
    }
  }

  const totalMinutes = h * 60 + m;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          max={24}
          step={1}
          inputMode="numeric"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="w-20"
          placeholder="0"
          aria-label="Hours"
          required={required && totalMinutes === 0}
        />
        <span className="text-sm text-muted-foreground">h</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          max={999}
          step={5}
          inputMode="numeric"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={normalize}
          className="w-20"
          placeholder="0"
          aria-label="Minutes"
        />
        <span className="text-sm text-muted-foreground">m</span>
      </div>
      <input type="hidden" name={name} value={totalMinutes} />
    </div>
  );
}
