"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/form-field";
import {
  saveAvailabilitySlotsAction,
  saveAvailabilityOverrideAction,
  deleteAvailabilityOverrideAction,
} from "./actions";

type Slot = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type Override = {
  id: string;
  date: string;
  kind: "off" | "custom";
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export function AvailabilityEditor({
  initialSlots,
  initialOverrides,
}: {
  initialSlots: Slot[];
  initialOverrides: Override[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [pending, startTransition] = useTransition();

  function addSlot(day: number) {
    setSlots((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        day_of_week: day,
        start_time: "09:00",
        end_time: "17:00",
      },
    ]);
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSlot(
    id: string,
    field: "start_time" | "end_time",
    value: string,
  ) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    );
  }

  function saveRecurring() {
    startTransition(async () => {
      const fd = new FormData();
      for (const s of slots) {
        fd.append(
          "slots",
          `${s.day_of_week}|${s.start_time}|${s.end_time}`,
        );
      }
      const res = await saveAvailabilitySlotsAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Schedule saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Recurring weekly slots */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-base font-semibold">Regular weekly hours</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          These apply every week. You can add more than one slot per day
          if you work split shifts.
        </p>

        <div className="space-y-3">
          {DAYS.map((day) => {
            const daySlots = slots
              .filter((s) => s.day_of_week === day.value)
              .sort((a, b) => a.start_time.localeCompare(b.start_time));
            return (
              <div
                key={day.value}
                className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="w-12 shrink-0 pt-1.5 text-sm font-semibold">
                  {day.label}
                </div>
                <div className="flex-1 space-y-2">
                  {daySlots.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Not available
                    </p>
                  ) : (
                    daySlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="flex items-center gap-2"
                      >
                        <Input
                          type="time"
                          value={slot.start_time}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "start_time",
                              e.target.value,
                            )
                          }
                          className="w-[6.5rem]"
                        />
                        <span className="text-xs text-muted-foreground">
                          to
                        </span>
                        <Input
                          type="time"
                          value={slot.end_time}
                          onChange={(e) =>
                            updateSlot(
                              slot.id,
                              "end_time",
                              e.target.value,
                            )
                          }
                          className="w-[6.5rem]"
                        />
                        <button
                          type="button"
                          onClick={() => removeSlot(slot.id)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Remove slot"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => addSlot(day.value)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                    {daySlots.length === 0 ? "Add hours" : "Add another slot"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={saveRecurring} disabled={pending}>
            {pending ? "Saving…" : "Save schedule"}
          </Button>
        </div>
      </section>

      {/* One-off overrides */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-base font-semibold">
          One-off days (vacation, different hours)
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Override a specific date. Mark a day off or change the hours for
          that date only.
        </p>

        <OverrideList initialOverrides={initialOverrides} />
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------

function OverrideList({ initialOverrides }: { initialOverrides: Override[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"off" | "custom">("off");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [reason, setReason] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      toast.error("Pick a date.");
      return;
    }
    const fd = new FormData();
    fd.set("date", date);
    fd.set("kind", kind);
    if (kind === "custom") {
      fd.set("start_time", start);
      fd.set("end_time", end);
    }
    fd.set("reason", reason);
    startTransition(async () => {
      const res = await saveAvailabilityOverrideAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Override saved");
      setDate("");
      setReason("");
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Remove this override?")) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const res = await deleteAvailabilityOverrideAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Override removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Add new */}
      <form
        onSubmit={submit}
        className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ov_date">Date</Label>
            <Input
              id="ov_date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ov_kind">What</Label>
            <FormSelect
              id="ov_kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as "off" | "custom")}
            >
              <option value="off">Day off / unavailable</option>
              <option value="custom">Different hours that day</option>
            </FormSelect>
          </div>
        </div>

        {kind === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ov_start">Start</Label>
              <Input
                id="ov_start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ov_end">End</Label>
              <Input
                id="ov_end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ov_reason">Reason (optional)</Label>
          <Input
            id="ov_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Doctor appointment, school event"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={pending} size="sm">
            <Plus className="h-3.5 w-3.5" />
            {pending ? "Saving…" : "Add override"}
          </Button>
        </div>
      </form>

      {/* Existing overrides */}
      {initialOverrides.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No upcoming overrides.
        </p>
      ) : (
        <ul className="space-y-2">
          {initialOverrides.map((ov) => (
            <li
              key={ov.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
            >
              <div className="flex items-start gap-3">
                <CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <div className="text-sm font-medium">
                    {new Date(`${ov.date}T12:00:00`).toLocaleDateString(
                      "en-US",
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      },
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ov.kind === "off"
                      ? "Off"
                      : `${ov.start_time ?? "—"} – ${ov.end_time ?? "—"}`}
                    {ov.reason ? ` · ${ov.reason}` : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(ov.id)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label="Remove override"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
