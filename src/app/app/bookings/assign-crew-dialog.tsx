"use client";

import { useActionState, useState, useEffect, useMemo } from "react";
import { Users, Check, Info, AlertTriangle } from "lucide-react";
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

export type AssignableEmployee = {
  id: string;
  label: string;
  /** True when this cleaner has an accommodation / health note on file. We
   * surface a discreet flag here; the note itself stays on the employee file. */
  hasAccommodations?: boolean;
};

/** Join names like "Maria, Anna & Olha". */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * Crew-assignment popup. Pick everyone working the shift — they all work the
 * SAME hours, together (a team). No "lead" to choose; the first selected is
 * stored as the primary behind the scenes so the rest of the app keeps
 * working. For a hand-off (one cleaner takes over partway through) that's a
 * separate "split shift", set up in the booking's edit screen.
 *
 * Selecting 2+ cleaners shows a confirmation so a team can't be mistaken for
 * a split.
 */
export function AssignCrewDialog({
  bookingId,
  employees,
  initialPrimaryId,
  initialAdditionalIds,
  seriesId,
  seriesScheduledAt,
  clientName,
  open,
  onOpenChange,
}: {
  bookingId: string;
  employees: AssignableEmployee[];
  initialPrimaryId: string | null;
  initialAdditionalIds: string[];
  seriesId?: string | null;
  seriesScheduledAt?: string;
  /** Client name for the confirmation copy ("…at Acme Corp"). Optional. */
  clientName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, action] = useActionState<AssignCrewState, FormData>(
    assignBookingCrewAction,
    EMPTY,
  );
  // Ordered selection — the first entry becomes the stored primary.
  const [selectedIds, setSelectedIds] = useState<string[]>([
    ...(initialPrimaryId ? [initialPrimaryId] : []),
    ...initialAdditionalIds,
  ]);
  const [updateScope, setUpdateScope] = useState<
    "this_only" | "this_and_future"
  >("this_only");
  const [confirming, setConfirming] = useState(false);

  // Sync local selection to the booking's current crew whenever the dialog
  // opens for a (possibly different) booking. One-time setState on open is
  // the intended pattern here.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedIds([
      ...(initialPrimaryId ? [initialPrimaryId] : []),
      ...initialAdditionalIds,
    ]);
    setUpdateScope("this_only");
    setConfirming(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, bookingId, initialPrimaryId, initialAdditionalIds]);

  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state.ok, onOpenChange]);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const primaryId = selectedIds[0] ?? "";
  const additionalIds = selectedIds.slice(1);
  const labelById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.label])),
    [employees],
  );
  const selectedNames = selectedIds.map((id) => labelById.get(id) ?? "—");
  const count = selectedIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Assign cleaners
          </DialogTitle>
          <DialogDescription>
            Select everyone working this shift — they all work the same hours,
            together.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={bookingId} />
          <input type="hidden" name="primary_id" value={primaryId} />
          {additionalIds.map((id) => (
            <input key={id} type="hidden" name="additional_ids" value={id} />
          ))}
          <input type="hidden" name="update_scope" value={updateScope} />
          <input type="hidden" name="series_id" value={seriesId ?? ""} />
          <input
            type="hidden"
            name="series_scheduled_at"
            value={seriesScheduledAt ?? ""}
          />

          <FormError message={state.error} />

          {!confirming ? (
            <>
              {seriesId && (
                <fieldset className="rounded-md border border-border p-3">
                  <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Apply to
                  </legend>
                  <div className="mt-2 space-y-2">
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="scope_radio"
                        checked={updateScope === "this_only"}
                        onChange={() => setUpdateScope("this_only")}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span>
                        <span className="font-medium">Just this booking</span>
                        <span className="block text-xs text-muted-foreground">
                          Only this occurrence is reassigned.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="scope_radio"
                        checked={updateScope === "this_and_future"}
                        onChange={() => setUpdateScope("this_and_future")}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span>
                        <span className="font-medium">
                          This and all future bookings
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Updates every upcoming booking in this series.
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              )}

              <div>
                <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Cleaners on this shift</span>
                  {count > 0 && (
                    <span className="text-foreground">{count} selected</span>
                  )}
                </p>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {employees.map((e) => {
                    const selected = selectedIds.includes(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggle(e.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted",
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
                        {e.hasAccommodations && (
                          <span
                            title="Has accommodations on file — check the employee file before assigning"
                            className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Note
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="flex items-start gap-1.5 rounded-md bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Everyone selected works the <strong>full shift together</strong>.
                  Need a <strong>hand-off</strong> instead — one cleaner takes
                  over from another partway through? That&rsquo;s a{" "}
                  <strong>split shift</strong>, turned on in the booking form.
                </span>
              </p>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                {count >= 2 ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setConfirming(true)}
                  >
                    Review &amp; save
                  </Button>
                ) : (
                  <SubmitButton size="sm" pendingLabel="Saving…">
                    {updateScope === "this_and_future"
                      ? "Save this & future"
                      : "Save"}
                  </SubmitButton>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-sm">
                  Assign{" "}
                  <strong className="text-foreground">
                    {joinNames(selectedNames)}
                  </strong>{" "}
                  to work the <strong>full shift together</strong>
                  {clientName ? (
                    <>
                      {" "}
                      at <strong>{clientName}</strong>
                    </>
                  ) : null}
                  ?
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  All {count} cleaners work the same hours. This is a{" "}
                  <strong>team</strong>, not a split / hand-off.
                  {updateScope === "this_and_future" &&
                    " Applied to this and all future bookings in the series."}
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  Back
                </Button>
                <SubmitButton size="sm" pendingLabel="Saving…">
                  Yes, assign {count} cleaners
                </SubmitButton>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
