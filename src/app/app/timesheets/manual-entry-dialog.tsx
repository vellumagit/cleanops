"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
// <input type="datetime-local"> expects "YYYY-MM-DDTHH:mm" in the user's
// *display* wall-clock. Rendering a UTC timestamp in the org's tz lets us
// prefill edit forms correctly. On submit, the server converts back to UTC
// via localInputToUtcIso.

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
  }, [open, mode, editing, employees, orgTz]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const activeEmployees = useMemo(
    () => employees.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

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
              ? "Adjust who worked, which booking they worked on, and the start/end times."
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
            <p className="text-[11px] text-muted-foreground">
              Leave blank for non-job time (office work, driving, quoting a
              lead, etc.). Linking a booking enables punctuality + completion
              analysis.
            </p>
          </div>

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
