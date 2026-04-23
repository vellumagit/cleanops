"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  toggleChecklistItemAction,
  removeChecklistItemAction,
} from "./actions";

export type BookingChecklistItem = {
  id: string;
  ordinal: number;
  title: string;
  phase: "pre" | "during" | "post";
  is_required: boolean;
  checked_at: string | null;
};

type Props = {
  bookingId: string;
  items: BookingChecklistItem[];
  /** Allow the viewer to delete items (admins) — hidden on field app. */
  canRemove?: boolean;
};

const PHASE_LABEL = {
  pre: "Before job",
  during: "During job",
  post: "After job",
} as const;

export function BookingChecklist({ bookingId, items, canRemove }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Local state so clicks feel instant — server syncs in the background.
  const [localChecked, setLocalChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((i) => [i.id, !!i.checked_at])),
  );

  function toggle(id: string, currentlyChecked: boolean) {
    const next = !currentlyChecked;
    setLocalChecked((prev) => ({ ...prev, [id]: next }));
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("checked", next ? "1" : "0");
      const res = await toggleChecklistItemAction(fd);
      if (!res.ok) {
        // Roll back optimistic update on error.
        setLocalChecked((prev) => ({ ...prev, [id]: currentlyChecked }));
        toast.error(res.error);
        return;
      }
    });
  }

  function remove(id: string) {
    if (!confirm("Remove this item from the checklist?")) return;
    const fd = new FormData();
    fd.set("id", id);
    fd.set("booking_id", bookingId);
    startTransition(async () => {
      const res = await removeChecklistItemAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  const grouped: Record<
    "pre" | "during" | "post",
    BookingChecklistItem[]
  > = { pre: [], during: [], post: [] };
  for (const it of items.sort((a, b) => a.ordinal - b.ordinal)) {
    grouped[it.phase].push(it);
  }

  const total = items.length;
  const done = items.filter((i) => localChecked[i.id]).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {done}/{total} complete
        </span>
        {pending && <span className="text-[10px]">Saving…</span>}
      </div>

      {(["pre", "during", "post"] as const).map((phase) => {
        const rows = grouped[phase];
        if (rows.length === 0) return null;
        return (
          <div key={phase}>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {PHASE_LABEL[phase]}
            </h4>
            <ul className="space-y-1.5">
              {rows.map((it) => {
                const isChecked = !!localChecked[it.id];
                return (
                  <li
                    key={it.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors",
                      isChecked
                        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                        : "border-border bg-background",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(it.id, isChecked)}
                      aria-label={
                        isChecked ? "Mark incomplete" : "Mark complete"
                      }
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isChecked
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-muted-foreground/30 hover:border-foreground",
                      )}
                    >
                      {isChecked ? (
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      ) : (
                        <Circle className="h-3 w-3 opacity-0" />
                      )}
                    </button>
                    <span
                      className={cn(
                        "flex-1",
                        isChecked && "text-muted-foreground line-through",
                      )}
                    >
                      {it.title}
                      {it.is_required && !isChecked && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          Required
                        </span>
                      )}
                    </span>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => remove(it.id)}
                        aria-label="Remove"
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
