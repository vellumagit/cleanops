"use client";

import { useState, useTransition } from "react";
import { Bookmark, Plus, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  saveSchedulerViewAction,
  deleteSchedulerViewAction,
  type SchedulerViewRow,
} from "./views-actions";
import type { SchedulerFilters } from "./scheduler-filters";

/**
 * Saved views dropdown. Lets owners curate a small menu of preset
 * filter combinations that every user in the org sees next to the
 * ad-hoc Filters pill. Shared across the org per the product decision.
 *
 * Interactions:
 *   - Click a view → applies its filters
 *   - "Save current…" → prompts for a name, saves the current
 *     filters as a new shared view
 *   - Trash icon next to a view → deletes it (managers+ only; shown
 *     for everyone but server rejects non-managers)
 */
export function SavedViews({
  views: initialViews,
  currentFilters,
  canEdit,
  onApply,
}: {
  views: SchedulerViewRow[];
  currentFilters: SchedulerFilters;
  canEdit: boolean;
  onApply: (filters: SchedulerFilters) => void;
}) {
  const [views, setViews] = useState(initialViews);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  function apply(view: SchedulerViewRow) {
    onApply(view.filters as SchedulerFilters);
    setActiveViewId(view.id);
    setOpen(false);
  }

  function handleSaveCurrent() {
    const name = window.prompt("Name this view:");
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const result = await saveSchedulerViewAction({
        name,
        filters: currentFilters as unknown as Record<string, unknown>,
      });
      if (result.error || !result.view) {
        setError(result.error ?? "Could not save");
        return;
      }
      setViews((prev) => [...prev, result.view!]);
      setActiveViewId(result.view.id);
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm("Delete this saved view?")) return;
    startTransition(async () => {
      const result = await deleteSchedulerViewAction(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setViews((prev) => prev.filter((v) => v.id !== id));
      if (activeViewId === id) setActiveViewId(null);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
          activeViewId && "border-foreground/40",
        )}
      >
        <Bookmark className="h-3.5 w-3.5" />
        {activeViewId
          ? views.find((v) => v.id === activeViewId)?.name ?? "Views"
          : "Views"}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-2 shadow-lg">
            <div className="flex items-center justify-between px-2 py-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Saved views
              </p>
              <span className="text-[10px] text-muted-foreground">
                Shared
              </span>
            </div>
            {views.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No saved views yet.
                {canEdit && " Save one below."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {views.map((v) => {
                  const active = activeViewId === v.id;
                  return (
                    <li key={v.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => apply(v)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted",
                          active && "bg-muted font-medium",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                            active
                              ? "border-foreground bg-foreground text-background"
                              : "border-border",
                          )}
                        >
                          {active && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className="truncate">{v.name}</span>
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDelete(v.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label={`Delete ${v.name}`}
                          title={`Delete ${v.name}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && (
              <div className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  onClick={handleSaveCurrent}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Save current filters as view…
                </button>
              </div>
            )}

            {error && (
              <p className="mt-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
