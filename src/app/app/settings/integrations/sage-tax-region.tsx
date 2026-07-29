"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSageTaxRegionAction } from "./sage-actions";

/**
 * Tax-region picker for the Sage card.
 *
 * Sage's US and Canadian editions require a tax_address_region_id on every
 * sales invoice — without one the POST fails with 422 and nothing reaches the
 * books. Clients store only a free-text address, so there is nothing
 * structured to derive this from; the org sets one default here.
 *
 * Falls back to a free-text id when the list can't be loaded, so a Sage API
 * hiccup can't leave someone stuck staring at an empty dropdown.
 */
export function SageTaxRegionForm({
  regions,
  current,
  loadError,
}: {
  regions: Array<{ id: string; label: string }>;
  current: string | null;
  loadError: string | null;
}) {
  const [value, setValue] = useState(current ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    const region = value.trim();
    if (!region) {
      toast.error("Pick a tax region first.");
      return;
    }
    startTransition(async () => {
      const res = await saveSageTaxRegionAction(region);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save — please try again.");
        return;
      }
      toast.success(`Sage tax region set to ${region}.`);
    });
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-background/50 p-2 text-left">
      <label
        htmlFor="sage-tax-region"
        className="block text-[11px] font-medium text-foreground"
      >
        Tax region
      </label>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Sage won&apos;t accept an invoice without one, and your tax rate has to
        exist in Sage for this region.
      </p>

      {regions.length > 0 ? (
        <select
          id="sage-tax-region"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select a region…</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            id="sage-tax-region"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. CA-ON"
            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          {loadError && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Couldn&apos;t load the list from Sage ({loadError}) — enter the id
              by hand.
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || value.trim() === (current ?? "")}
        className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        {pending ? "Saving…" : current ? "Update region" : "Save region"}
      </button>
    </div>
  );
}
