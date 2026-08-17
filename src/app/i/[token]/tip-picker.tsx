"use client";

import { useState } from "react";
import type { TipPreset } from "@/lib/tip-split";

/**
 * "Add a tip" on the public invoice page.
 *
 * Sits INSIDE the pay form and writes a hidden tip_cents field, so choosing a
 * tip and paying stay one action. A separate "apply tip" step would be one
 * more thing to forget between picking and paying.
 *
 * No tip is the default and it is a real, visible option rather than the
 * absence of a choice — a picker where every button charges you something and
 * the only escape is not pressing anything is a dark pattern, and this appears
 * on a document sent in the cleaner's name.
 */
export function TipPicker({
  presets,
  recipientName,
  currencyFormat,
}: {
  presets: TipPreset[];
  /** The one cleaner who did every job on this invoice, when there is one. */
  recipientName: string | null;
  /** Pre-formatted amounts, keyed by cents — formatting money is the server's job. */
  currencyFormat: Record<number, string>;
}) {
  const [selected, setSelected] = useState<number>(0);
  const [custom, setCustom] = useState<string>("");
  const [showCustom, setShowCustom] = useState(false);

  // The form posts cents. A custom entry is dollars in the box, cents on the
  // wire; anything unparseable is treated as no tip rather than as an error,
  // because failing a payment over a typo in an optional field is absurd.
  const customCents = (() => {
    const n = Number(custom.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  })();
  const effectiveCents = showCustom ? customCents : selected;

  const btn = (active: boolean) =>
    [
      "flex-1 rounded-md border px-2 py-2 text-xs font-semibold transition-colors",
      active
        ? "border-transparent text-white"
        : "border-border bg-card text-foreground hover:bg-muted/60",
    ].join(" ");

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="tip_cents" value={effectiveCents} />

      <p className="text-sm font-semibold text-foreground">
        {recipientName ? `Add a tip for ${recipientName}?` : "Add a tip?"}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {recipientName
          ? `100% goes to ${recipientName}.`
          : "100% goes to the cleaners who did the work."}
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setSelected(0);
            setShowCustom(false);
          }}
          className={btn(!showCustom && selected === 0)}
          style={
            !showCustom && selected === 0
              ? { backgroundColor: "var(--brand, #6366f1)" }
              : undefined
          }
        >
          No tip
        </button>

        {presets.map((p) => (
          <button
            key={p.percent}
            type="button"
            onClick={() => {
              setSelected(p.cents);
              setShowCustom(false);
            }}
            className={btn(!showCustom && selected === p.cents)}
            style={
              !showCustom && selected === p.cents
                ? { backgroundColor: "var(--brand, #6366f1)" }
                : undefined
            }
          >
            <span className="block">{p.percent}%</span>
            <span className="block text-[10px] font-normal opacity-80">
              {currencyFormat[p.cents] ?? ""}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className={btn(showCustom)}
          style={showCustom ? { backgroundColor: "var(--brand, #6366f1)" } : undefined}
        >
          Other
        </button>
      </div>

      {showCustom && (
        <div className="mt-3">
          <label
            htmlFor="tip-custom"
            className="text-[11px] font-medium text-muted-foreground"
          >
            Tip amount
          </label>
          <input
            id="tip-custom"
            type="text"
            inputMode="decimal"
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}
    </div>
  );
}
