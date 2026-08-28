"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, History, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-field";
import {
  createManualTimeEntryAction,
  updateTimeEntryAction,
  deleteTimeEntryAction,
  fetchTimeEntryHistoryAction,
  type TimeEntryHistoryRow,
} from "./actions";
import type { EmployeeMeta, BookingOption } from "./types";

// -----------------------------------------------------------------------------

type Mode = "create" | "edit";

export type EditingEntry = {
  id: string;
  employee_id: string;
  booking_id: string | null;
  clock_in_at: string; // UTC ISO
  clock_out_at: string | null; // UTC ISO
  notes: string | null;
  /* --- Why this row is being corrected. Without it the editor was just two
     datetime boxes, and you had to remember what the row said. --- */
  needs_review: boolean;
  /** The cron wrote this clock-out, not a person. */
  auto_closed: boolean;
  /** Minutes past the allotment, 0 if within it. */
  over_allotted_minutes: number;
  /** When the shift was due to end (UTC ISO), or null for off-job time. */
  expected_end_at: string | null;
  client_name: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  /** Prefilled entry when mode === "edit". */
  editing: EditingEntry | null;
  employees: EmployeeMeta[];
  bookings: BookingOption[];
  orgTz: string;
};

// -----------------------------------------------------------------------------
// Datetime helpers
//
// <input type="datetime-local"> expects "YYYY-MM-DDTHH:mm[:ss]" in the user's
// *display* wall-clock. Rendering a UTC timestamp in the org's tz lets us
// prefill edit forms correctly. On submit, the server converts back to UTC
// via localInputToUtcIso.
//
// MINUTES IN THE UI, MILLISECONDS IN THE VAULT. A clock punch is recorded to
// the millisecond, and back-to-back punches land fractions apart — so an
// untouched field must never be truncated on save (that used to rewind a
// start into the previous entry and trip the overlap guard). The old answer
// was step="1" seconds inputs; the seconds spinner then ate Svitlana's
// keystrokes (20:30:30, 23:10:10 where she typed :00). Now the inputs are
// plain minute-precision and the server compares at MINUTE granularity
// (preserveWithinMinute): same minute means untouched, keep the stored
// instant with all its precision; a new minute is a real edit and lands
// exactly as typed.

function utcIsoToLocalInput(utc: string, tz: string): string {
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "6h 30m" from two datetime-local strings, or null if not both valid. */
function durationLabel(start: string, end: string): string | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const mins = Math.round((b - a) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatBookingLabel(b: BookingOption, tz: string): string {
  const d = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(b.scheduled_at));
  const service = b.service_type
    ? b.service_type.replace(/_/g, " ")
    : "booking";
  return `${b.client_name} · ${service} · ${d}`;
}

// -----------------------------------------------------------------------------

export function ManualEntryDialog({
  open,
  onOpenChange,
  mode,
  editing,
  employees,
  bookings,
  orgTz,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [employeeId, setEmployeeId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Inline edit history (audit_log entries for this time_entry). Lazy-loaded
  // when the dialog opens in edit mode; hidden by default to keep the
  // form view uncluttered. Owners click "Show history" to reveal.
  // Expected end, in the two shapes the UI needs: a datetime-local value to
  // write into the input, and a short label to show on the button.
  const expectedEndLocal =
    mode === "edit" && editing?.expected_end_at
      ? utcIsoToLocalInput(editing.expected_end_at, orgTz)
      : "";
  const expectedEndDisplay =
    mode === "edit" && editing?.expected_end_at
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: orgTz,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(editing.expected_end_at))
      : "";

  const liveDuration = durationLabel(startAt, endAt);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TimeEntryHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Editing is "fix a time" 95% of the time — who worked and which job are
  // already right. Both dropdowns stay hidden in edit mode until asked for,
  // and the header states them as plain text instead. Brian: "cluttered
  // when it doesn't need to be."
  const [reassignOpen, setReassignOpen] = useState(false);

  // Reset fields when the dialog opens in a new mode or for a new entry.
  // Sync'ing local form state to an external trigger (the open toggle) is
  // the idiomatic effect use — acknowledged via the compiler escape hatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && editing) {
      setEmployeeId(editing.employee_id);
      setBookingId(editing.booking_id ?? "");
      setStartAt(utcIsoToLocalInput(editing.clock_in_at, orgTz));
      setEndAt(
        editing.clock_out_at
          ? utcIsoToLocalInput(editing.clock_out_at, orgTz)
          : "",
      );
      setNotes(editing.notes ?? "");
    } else {
      setEmployeeId(employees[0]?.id ?? "");
      setBookingId("");
      setStartAt("");
      setEndAt("");
      setNotes("");
    }
    setFormError(null);
    // Reset history + reassign state when dialog opens for a new entry
    setHistoryOpen(false);
    setHistory([]);
    setReassignOpen(false);
  }, [open, mode, editing, employees, orgTz]);

  async function loadHistory() {
    if (!editing || mode !== "edit") return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const rows = await fetchTimeEntryHistoryAction(editing.id);
      setHistory(rows);
    } catch (err) {
      console.error("[timesheet] history load failed:", err);
      toast.error("Could not load entry history.");
    } finally {
      setHistoryLoading(false);
    }
  }
  /* eslint-enable react-hooks/set-state-in-effect */

  const activeEmployees = useMemo(
    () => employees.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  // Plain-text statement of who/what this entry is, for the edit header.
  const contextEmployee =
    activeEmployees.find((e) => e.id === employeeId)?.name ?? "Team member";
  const contextBookingRow = bookings.find((b) => b.id === bookingId);
  const contextBooking = bookingId
    ? contextBookingRow
      ? formatBookingLabel(contextBookingRow, orgTz)
      : "linked booking"
    : "no booking (office/admin time)";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    if (mode === "edit" && editing) fd.set("id", editing.id);
    fd.set("employee_id", employeeId);
    fd.set("booking_id", bookingId);
    fd.set("start_at", startAt);
    fd.set("end_at", endAt);
    fd.set("notes", notes);

    startTransition(async () => {
      const action =
        mode === "edit" ? updateTimeEntryAction : createManualTimeEntryAction;
      const result = await action(fd);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toast.success(mode === "edit" ? "Entry updated" : "Hours logged");
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!editing) return;
    if (!confirm("Delete this time entry? This can't be undone.")) return;
    const fd = new FormData();
    fd.set("id", editing.id);
    startTransition(async () => {
      const result = await deleteTimeEntryAction(fd);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toast.success("Entry deleted");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit time entry" : "Log hours"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? `${contextEmployee} · ${contextBooking}`
              : "Back-fill hours for a shift that wasn't clocked on the phone. The entry shows up on payroll alongside live clock-ins."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          )}

          {(mode === "create" || reassignOpen) && (
          <div className="space-y-1.5">
            <Label htmlFor="employee_id">Employee</Label>
            <FormSelect
              id="employee_id"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
            >
              <option value="">Pick an employee…</option>
              {activeEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                  {emp.role && emp.role !== "employee" ? ` · ${emp.role}` : ""}
                </option>
              ))}
            </FormSelect>
          </div>
          )}

          {(mode === "create" || reassignOpen) && (
          <div className="space-y-1.5">
            <Label htmlFor="booking_id">
              Booking{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <FormSelect
              id="booking_id"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
            >
              <option value="">— No booking (office / admin time)</option>
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatBookingLabel(b, orgTz)}
                </option>
              ))}
            </FormSelect>
            {mode === "create" && (
              <p className="text-[11px] text-muted-foreground">
                Leave blank for non-job time — office work, driving, quoting.
              </p>
            )}
          </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="start_at">Start</Label>
              <Input
                id="start_at"
                name="start_at"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_at">
                End{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="end_at"
                name="end_at"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>

          {/*
           * Why this row is open for correction, and the one number that
           * makes the decision. Previously the editor was two datetime boxes
           * with no context: you had to remember what the row said, and
           * there was no hint that saving is what clears the flag.
           */}
          {mode === "edit" && editing && (editing.needs_review || editing.over_allotted_minutes > 0) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                {editing.auto_closed
                  ? "Nobody clocked out — the system capped this shift"
                  : editing.needs_review
                    ? "Flagged for review"
                    : "Ran past the time allotted for this job"}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-300/80">
                {editing.auto_closed
                  ? "The end time below was written by the system, not by a person. Set it to what actually happened."
                  : "The hours below are as recorded. Confirm or correct them."}
                {expectedEndLocal
                  ? ` This shift was due to end at ${expectedEndDisplay}.`
                  : ""}
                {" Saving clears the flag and unblocks payroll."}
              </p>
              {expectedEndLocal && (
                <button
                  type="button"
                  onClick={() => setEndAt(expectedEndLocal)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-background px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-950/60"
                >
                  <Clock className="h-3 w-3" />
                  Use expected end ({expectedEndDisplay})
                </button>
              )}
            </div>
          )}

          {/* The number payroll actually pays on — visible while you type,
              rather than only after saving. */}
          <div className="flex items-center justify-between gap-3">
            {liveDuration ? (
              <p className="text-xs text-muted-foreground">
                Recorded time:{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {liveDuration}
                </span>
              </p>
            ) : (
              <span />
            )}
            {mode === "edit" && !reassignOpen && (
              <button
                type="button"
                onClick={() => setReassignOpen(true)}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Change person or booking
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">
              Notes{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Filled in for Pat; client asked to extend an hour."
            />
          </div>

          {/* Inline edit history (edit mode only). Lazy-loaded so the
              dialog stays snappy when opening a long-history entry. */}
          {mode === "edit" && editing && (
            !historyOpen ? (
              <button
                type="button"
                onClick={loadHistory}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                <History className="h-3 w-3" />
                Show history
              </button>
            ) : (
            <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <History className="h-3.5 w-3.5" />
                    Audit history
                  </div>
                  {historyLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No audit entries for this row yet.
                    </p>
                  ) : (
                    <ol className="space-y-1.5 text-[11px]">
                      {history.map((h) => (
                        <li
                          key={h.id}
                          className="rounded border border-border/60 bg-background px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">
                              {h.action}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {new Date(h.created_at).toLocaleString("en-US", {
                                timeZone: orgTz,
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            by {h.actor_name}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
            </div>
            )
          )}

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            {mode === "edit" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={pending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {mode === "edit" ? (
                  <>
                    <Pencil className="h-4 w-4" />
                    {pending ? "Saving…" : "Save changes"}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {pending ? "Saving…" : "Log hours"}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
