"use client";

import { Fragment, useActionState, useState, useEffect, useMemo } from "react";
import type { Unavailable } from "@/lib/crew-availability";
import { getCrewAvailabilityForBookingAction } from "./crew-availability";
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
import { PutOnAnywayButton } from "./put-on-anyway-button";
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
type AssignCrewDialogProps = {
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
};

/**
 * A fresh pop-up every time it opens.
 *
 * The save's last answer lives in the pop-up (useActionState), and closing
 * it did not clear it. So after a series save that said "Saved, but Jordan
 * was left off Jan 2", opening Change crew again showed that same message
 * and a Done button instead of the crew list, and a refused save came back
 * with its old refusal already on screen. Nothing short of reloading the
 * page got the list back (found on the live site, 2026-11-23). The body is
 * remounted on each open, which starts the action's state from empty.
 */
export function AssignCrewDialog(props: AssignCrewDialogProps) {
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpened((n) => n + 1);
  }
  return <AssignCrewDialogBody key={opened} {...props} />;
}

function AssignCrewDialogBody({
  bookingId,
  employees,
  initialPrimaryId,
  initialAdditionalIds,
  seriesId,
  seriesScheduledAt,
  clientName,
  open,
  onOpenChange,
}: AssignCrewDialogProps) {
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

  // Saved with something to know (a series save left someone off some
  // visits): stay open and say it, rather than close on it.
  useEffect(() => {
    if (state.ok && !state.notice) onOpenChange(false);
  }, [state.ok, state.notice, onOpenChange]);

  // Who isn't free for this visit, asked each time the pop-up opens. Kept
  // with the booking it answers for. A failed check lists everyone and says
  // so; it never reads as "everyone is free".
  const crewKey = [...selectedIds].sort().join(",");
  const [freeCheck, setFreeCheck] = useState<{
    bookingId: string;
    unavailable: Record<string, Unavailable> | null;
  } | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      let res: Awaited<ReturnType<typeof getCrewAvailabilityForBookingAction>>;
      try {
        res = await getCrewAvailabilityForBookingAction(bookingId, crewKey ? crewKey.split(",") : []);
      } catch {
        res = { ok: false };
      }
      if (!cancelled) setFreeCheck({ bookingId, unavailable: res.ok ? res.unavailable : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, bookingId, crewKey]);
  const checked = freeCheck && freeCheck.bookingId === bookingId ? freeCheck : null;
  const away: Record<string, Unavailable> = checked?.unavailable ?? {};
  // Free people first; the rest underneath with the reason. Someone already
  // ticked stays where they were, marked.
  const freeFirst = [
    ...employees.filter((e) => !away[e.id] || selectedIds.includes(e.id)),
    ...employees.filter((e) => away[e.id] && !selectedIds.includes(e.id)),
  ];
  const firstAway = freeFirst.findIndex((e) => away[e.id] && !selectedIds.includes(e.id));

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
      {/* max-h/overflow removed — DialogContent handles it for every dialog
          now. Leaving them here would put a second scroll container on the
          popup itself and override the dvh height with vh. */}
      <DialogContent className="sm:max-w-md">
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

        {state.ok && state.notice ? (
          <div className="space-y-4">
            <p
              role="status"
              data-testid="cover-notice"
              className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <span className="font-semibold">Saved.</span> {state.notice}
            </p>
            {state.noticeBookingIds && state.noticeBookingIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <PutOnAnywayButton
                  bookingIds={state.noticeBookingIds}
                  onDone={() => onOpenChange(false)}
                />
                <span>Keeps them on those visits, double-booked, so you can move each visit yourself.</span>
              </div>
            )}
            <DialogFooter>
              <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
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

          <input type="hidden" name="confirm_time_off" value={state.confirmTimeOff ?? ""} />
          <FormError message={state.error} />
          {/* A double-booking the office may keep. The button posts
              the key itself, so a plain Save never keeps an overlap. */}
          {state.confirmOverlap && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                name="confirm_overlap"
                value={state.confirmOverlap}
                variant="outline"
                size="sm"
                data-testid="book-anyway"
              >
                Book anyway
              </Button>
              <span className="text-xs text-muted-foreground">
                Saves it with the overlap. Both jobs show as double-booked until one is moved.
              </span>
            </div>
          )}

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
                  {open && !checked && (
                    <p className="px-2 pb-1 text-[11px] text-muted-foreground">Checking who is free&hellip;</p>
                  )}
                  {checked && !checked.unavailable && (
                    <p className="px-2 pb-1 text-[11px] text-destructive">
                      Couldn&rsquo;t check who is free, so everyone is listed.
                    </p>
                  )}
                  {freeFirst.map((e, index) => {
                    const selected = selectedIds.includes(e.id);
                    const notFree = away[e.id];
                    return (
                      <Fragment key={e.id}>
                      {index === firstAway && (
                        <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Not free at that time
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => toggle(e.id)}
                        className={cn(
                          "flex w-full flex-wrap items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted",
                          selected && "bg-muted",
                          notFree && !selected && "text-muted-foreground",
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
                        {notFree && (
                          <span
                            className={cn(
                              "w-full pl-6 text-[11px]",
                              selected ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                            )}
                          >
                            {notFree.reason}
                          </span>
                        )}
                      </button>
                      </Fragment>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
