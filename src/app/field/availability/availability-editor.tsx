"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarOff, Check, Clock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/when-preview";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_END,
  DEFAULT_START,
  WEEK_DAYS,
  hoursError,
  overlapError,
  timeLabel,
  toHHMM,
  weekdayTemplate,
} from "@/lib/availability-week";
import {
  saveAvailabilitySlotsAction,
  saveAvailabilityOverrideAction,
  deleteAvailabilityOverrideAction,
} from "./actions";

/**
 * A cleaner's hours, written for a thumb (2026-11-14).
 *
 * The page before this was the data model with inputs on it: seven rows of
 * "Not available" with a small "Add hours" link each, "slots", "overrides",
 * a bin icon the size of a fingernail, and a Save button at the bottom of
 * the card that nothing reminded you to press. It worked, and a cleaner had
 * to be shown how.
 *
 * Now: one switch per day, in a week that starts on Monday. On means you
 * can work, with the hours right under it; off means you can't. One tap
 * fills Monday to Friday. Anything unsaved brings up a Save button that
 * stays on screen until it is pressed. Days off are their own card, in the
 * words a person would use.
 */

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

type Block = { id: string; start: string; end: string };
type Week = Record<number, Block[]>;

let blockSeq = 0;
const newBlock = (start: string, end: string): Block => ({
  id: `b${++blockSeq}`,
  start,
  end,
});

function weekFromSlots(slots: Slot[]): Week {
  const week: Week = {};
  for (const day of WEEK_DAYS) week[day.value] = [];
  for (const s of [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    week[s.day_of_week]?.push(
      newBlock(toHHMM(s.start_time) ?? DEFAULT_START, toHHMM(s.end_time) ?? DEFAULT_END),
    );
  }
  return week;
}

/** What gets saved, in a fixed order, so "has anything changed?" is a string compare. */
function encode(week: Week): string[] {
  return WEEK_DAYS.flatMap((d) =>
    [...(week[d.value] ?? [])]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => `${d.value}|${b.start}|${b.end}`),
  );
}

function dayProblem(blocks: Block[]): string | null {
  for (const b of blocks) {
    const p = hoursError(b.start, b.end);
    if (p) return p;
  }
  return overlapError(blocks);
}

export function AvailabilityEditor({
  initialSlots,
  initialOverrides,
}: {
  initialSlots: Slot[];
  initialOverrides: Override[];
}) {
  const router = useRouter();
  const [week, setWeek] = useState<Week>(() => weekFromSlots(initialSlots));
  const [saved, setSaved] = useState<string>(() => encode(weekFromSlots(initialSlots)).join(";"));
  const [pending, startTransition] = useTransition();

  const dirty = encode(week).join(";") !== saved;
  const problems = useMemo(() => {
    const out: Record<number, string | null> = {};
    for (const d of WEEK_DAYS) out[d.value] = dayProblem(week[d.value] ?? []);
    return out;
  }, [week]);
  const firstProblem = WEEK_DAYS.find((d) => problems[d.value]);
  const daysOn = WEEK_DAYS.filter((d) => (week[d.value] ?? []).length > 0).length;

  function setDay(day: number, blocks: Block[]) {
    setWeek((prev) => ({ ...prev, [day]: blocks }));
  }

  function toggleDay(day: number) {
    const on = (week[day] ?? []).length > 0;
    setDay(day, on ? [] : [newBlock(DEFAULT_START, DEFAULT_END)]);
  }

  function updateBlock(day: number, id: string, field: "start" | "end", value: string) {
    setDay(
      day,
      (week[day] ?? []).map((b) => (b.id === id ? { ...b, [field]: value } : b)),
    );
  }

  function sameHoursWeekdays() {
    const template = weekdayTemplate(
      Object.fromEntries(WEEK_DAYS.map((d) => [d.value, week[d.value] ?? []])),
    );
    setWeek((prev) => {
      const next = { ...prev };
      for (const day of [1, 2, 3, 4, 5]) {
        next[day] = template.map((b) => newBlock(b.start, b.end));
      }
      return next;
    });
  }

  function save() {
    if (firstProblem) {
      toast.error(`${firstProblem.label}: ${problems[firstProblem.value]}`);
      return;
    }
    const lines = encode(week);
    startTransition(async () => {
      const fd = new FormData();
      for (const line of lines) fd.append("slots", line);
      const res = await saveAvailabilitySlotsAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSaved(lines.join(";"));
      toast.success("Your hours are saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">The days you can work</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Switch on each day you can work and set the hours. This repeats
          every week until you change it.
        </p>

        <Button
          type="button"
          variant="outline"
          className="mt-4 h-11 w-full text-sm"
          onClick={sameHoursWeekdays}
        >
          <Clock className="mr-2 h-4 w-4" />
          Same hours Monday to Friday
        </Button>

        <ul className="mt-2 divide-y divide-border">
          {WEEK_DAYS.map((day) => {
            const blocks = week[day.value] ?? [];
            const on = blocks.length > 0;
            const problem = problems[day.value];
            return (
              <li key={day.value} className="py-3.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleDay(day.value)}
                  className="flex w-full touch-manipulation items-center justify-between gap-3 text-left"
                >
                  <span className="text-base font-semibold">{day.label}</span>
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "text-sm",
                        on ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                    >
                      {on ? "Can work" : "Can't work"}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors",
                        on ? "bg-emerald-600" : "bg-muted-foreground/30",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                          on ? "translate-x-[1.375rem]" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </span>
                </button>

                {on && (
                  <div className="mt-3 space-y-2">
                    {blocks.map((b, i) => (
                      <div key={b.id} className="flex items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${day.label} start`}
                          value={b.start}
                          onChange={(e) => updateBlock(day.value, b.id, "start", e.target.value)}
                          className="h-11 min-w-0 flex-1 text-base"
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          aria-label={`${day.label} end`}
                          value={b.end}
                          onChange={(e) => updateBlock(day.value, b.id, "end", e.target.value)}
                          className="h-11 min-w-0 flex-1 text-base"
                        />
                        {/* The first time is removed by switching the day off;
                            only an extra one needs its own way out. */}
                        {i > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDay(
                                day.value,
                                blocks.filter((x) => x.id !== b.id),
                              )
                            }
                            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive active:bg-muted"
                            aria-label={`Remove this ${day.label} time`}
                          >
                            <X className="h-5 w-5" />
                          </button>
                        ) : (
                          blocks.length > 1 && <span className="w-11 shrink-0" aria-hidden />
                        )}
                      </div>
                    ))}
                    {problem && (
                      <p role="alert" className="text-sm font-medium text-destructive">
                        {problem}
                      </p>
                    )}
                    {blocks.length < 3 && (
                      <button
                        type="button"
                        onClick={() => {
                          // After the last block, with a gap, so the new one
                          // is valid the moment it appears.
                          const last = [...blocks].sort((x, y) => x.end.localeCompare(y.end)).at(-1);
                          const [h] = (last?.end ?? DEFAULT_END).split(":").map(Number);
                          const start = Math.min(h + 1, 21);
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setDay(day.value, [
                            ...blocks,
                            newBlock(`${pad(start)}:00`, `${pad(start + 2)}:00`),
                          ]);
                        }}
                        className="inline-flex touch-manipulation items-center gap-1 rounded-md py-1.5 pr-2 text-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground"
                      >
                        <Plus className="h-4 w-4" />
                        Add a second time that day
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!dirty && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-emerald-600" />
            {daysOn === 0
              ? "No days switched on yet. The office doesn't know when you can work."
              : `Saved: you can work ${daysOn} day${daysOn === 1 ? "" : "s"} a week.`}
          </p>
        )}
      </section>

      {/* Stays on screen, above the tab bar, for as long as something is
          unsaved. The old Save button sat at the bottom of the card and
          looked the same whether or not there was anything to save. */}
      {dirty && (
        <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10">
          <div className="rounded-xl border border-border bg-card p-3 shadow-lg">
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base font-semibold"
              onClick={save}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save my hours"}
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {firstProblem
                ? `Fix ${firstProblem.label} first: ${problems[firstProblem.value]}`
                : "Your changes aren't saved yet."}
            </p>
          </div>
        </div>
      )}

      <DaysOff initialOverrides={initialOverrides} />
    </div>
  );
}

// -----------------------------------------------------------------------------

function dateLabel(ymd: string): string {
  // A calendar date, not a moment: noon UTC read back in UTC is that date
  // for every viewer.
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function DaysOff({ initialOverrides }: { initialOverrides: Override[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"off" | "custom">("off");
  const [date, setDate] = useState("");
  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);
  const [reason, setReason] = useState("");

  const customProblem = kind === "custom" ? hoursError(start, end) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      toast.error("Pick the date first.");
      return;
    }
    if (customProblem) {
      toast.error(customProblem);
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
      toast.success(kind === "off" ? "Day off added. The office has been told." : "Hours for that day saved");
      setDate("");
      setReason("");
      router.refresh();
    });
  }

  function remove(ov: Override) {
    if (!confirm(`Remove ${dateLabel(ov.date)}? Your usual hours apply to that day again.`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", ov.id);
      const res = await deleteAvailabilityOverrideAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">A day that&rsquo;s different</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Need one day off, or different hours on one day? Add it here. Your
        usual week stays as it is.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What is different">
          {(
            [
              { value: "off", label: "Day off", icon: CalendarOff },
              { value: "custom", label: "Different hours", icon: Clock },
            ] as const
          ).map((opt) => {
            const active = kind === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(opt.value)}
                className={cn(
                  "flex h-12 touch-manipulation items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                <opt.icon className="h-4 w-4" />
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ov_date">Which day</Label>
          <DateInput
            id="ov_date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        {kind === "custom" && (
          <div className="space-y-1.5">
            <Label htmlFor="ov_start">The hours you can work that day</Label>
            <div className="flex items-center gap-2">
              <Input
                id="ov_start"
                type="time"
                aria-label="Start"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-11 min-w-0 flex-1 text-base"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="time"
                aria-label="End"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-11 min-w-0 flex-1 text-base"
              />
            </div>
            {customProblem && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {customProblem}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ov_reason">Note for the office (optional)</Label>
          <Input
            id="ov_reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Doctor appointment"
            className="h-11 text-base"
          />
        </div>

        <Button type="submit" disabled={pending} size="lg" className="h-12 w-full text-base font-semibold">
          {pending ? "Saving…" : kind === "off" ? "Add day off" : "Save these hours"}
        </Button>
        {kind === "off" && (
          <p className="text-center text-xs text-muted-foreground">
            The office is told as soon as you add a day off.
          </p>
        )}
      </form>

      <h3 className="mt-6 text-sm font-semibold">Coming up</h3>
      {initialOverrides.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing yet. Every day follows your usual week.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {initialOverrides.map((ov) => (
            <li
              key={ov.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold">{dateLabel(ov.date)}</div>
                <div className="text-sm text-muted-foreground">
                  {ov.kind === "off"
                    ? "Day off"
                    : `${timeLabel(ov.start_time)} to ${timeLabel(ov.end_time)}`}
                  {ov.reason ? ` · ${ov.reason}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(ov)}
                disabled={pending}
                className="shrink-0 touch-manipulation rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-destructive active:bg-muted disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
