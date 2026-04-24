"use client";

import { useActionState, useState, useEffect } from "react";
import { Users, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import { cn } from "@/lib/utils";
import {
  assignBookingCrewAction,
  type AssignCrewState,
} from "./actions";

const EMPTY: AssignCrewState = {};

export type AssignableEmployee = { id: string; label: string };

/**
 * Quick crew-assignment popup. One primary (radio) + zero or more
 * additional crew (checkboxes). Re-uses the booking_assignees
 * junction semantics from the full edit form so a quick assignment
 * here looks identical to one done in /bookings/[id]/edit.
 *
 * Controlled via `open` so the trigger lives on whatever surface
 * wants to pop this — bookings list, scheduler quick view, etc.
 */
export function AssignCrewDialog({
  bookingId,
  employees,
  initialPrimaryId,
  initialAdditionalIds,
  open,
  onOpenChange,
}: {
  bookingId: string;
  employees: AssignableEmployee[];
  initialPrimaryId: string | null;
  initialAdditionalIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, action] = useActionState<AssignCrewState, FormData>(
    assignBookingCrewAction,
    EMPTY,
  );
  const [primaryId, setPrimaryId] = useState<string>(
    initialPrimaryId ?? "",
  );
  const [additionalIds, setAdditionalIds] = useState<Set<string>>(
    new Set(initialAdditionalIds),
  );

  // When the dialog is opened for a different booking, sync local
  // state to its initial values — otherwise a stale selection from
  // the previous booking leaks.
  useEffect(() => {
    if (!open) return;
    setPrimaryId(initialPrimaryId ?? "");
    setAdditionalIds(new Set(initialAdditionalIds));
  }, [open, bookingId, initialPrimaryId, initialAdditionalIds]);

  // Close on successful save.
  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state.ok, onOpenChange]);

  function toggleAdditional(id: string) {
    setAdditionalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Assign crew
          </DialogTitle>
          <DialogDescription>
            Pick a primary cleaner. Add more for two-person jobs, deep
            cleans, or move-outs.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={bookingId} />
          <input type="hidden" name="primary_id" value={primaryId} />
          {Array.from(additionalIds)
            .filter((id) => id !== primaryId)
            .map((id) => (
              <input
                key={id}
                type="hidden"
                name="additional_ids"
                value={id}
              />
            ))}

          <FormError message={state.error} />

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Primary cleaner
            </p>
            <div className="space-y-1">
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                  primaryId === "" && "bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="primary_radio"
                  checked={primaryId === ""}
                  onChange={() => setPrimaryId("")}
                  className="h-4 w-4"
                />
                <span className="text-muted-foreground italic">
                  Unassigned
                </span>
              </label>
              {employees.map((e) => (
                <label
                  key={e.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted",
                    primaryId === e.id && "bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="primary_radio"
                    checked={primaryId === e.id}
                    onChange={() => {
                      setPrimaryId(e.id);
                      // Auto-remove the new primary from additional so
                      // the same person isn't on both lists.
                      setAdditionalIds((prev) => {
                        if (!prev.has(e.id)) return prev;
                        const next = new Set(prev);
                        next.delete(e.id);
                        return next;
                      });
                    }}
                    className="h-4 w-4"
                  />
                  <span>{e.label}</span>
                </label>
              ))}
            </div>
          </div>

          {employees.filter((e) => e.id !== primaryId).length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Additional crew (optional)
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {employees
                  .filter((e) => e.id !== primaryId)
                  .map((e) => {
                    const selected = additionalIds.has(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggleAdditional(e.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                          selected && "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            selected
                              ? "border-foreground bg-foreground text-background"
                              : "border-border",
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span>{e.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Saving…">
              Save crew
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
