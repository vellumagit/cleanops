"use client";

import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormField } from "@/components/form-field";
import { HourMinuteField } from "@/components/hour-minute-field";
import {
  formatSegmentWindow,
  resolveSegmentWindows,
  segmentsOverlap,
  segmentsSpanMinutes,
} from "@/lib/booking-segments";
import {
  crewFormFields,
  toggleCrewMember,
  wholeVisit,
  type CrewState,
  type CrewWindow,
} from "./crew-state";

type Person = { id: string; label: string; hasAccommodations?: boolean };

function minutesLabel(total: number): string {
  if (total <= 0) return "0m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  return h > 0 ? `${h}h` : `${m}m`;
}

/**
 * One place to choose who is on a job — everyone equal — and, optionally,
 * when each of them is there. See crew-state.ts for why it replaced three
 * separate people-pickers.
 *
 * Controlled: the booking form owns the state so it can still pre-fill a
 * client's preferred cleaner into an empty crew. This component renders the
 * controls and the hidden fields the server reads.
 */
export function CrewPicker({
  people,
  state,
  onChange,
  allowTimes,
  scheduledAtLocal,
  jobMinutes,
  error,
}: {
  people: Person[];
  state: CrewState;
  /** The form's setState, used ONLY in its functional form: every change
   *  builds on the latest crew, so two quick taps can't work from a stale
   *  copy and undo each other. */
  onChange: Dispatch<SetStateAction<CrewState>>;
  /** Per-person times are hidden while creating a recurring series. */
  allowTimes: boolean;
  /** datetime-local value of the visit start, for the real clock times. */
  scheduledAtLocal: string;
  jobMinutes: number;
  error?: string;
}) {
  const fields = crewFormFields(
    allowTimes ? state : { ...state, timesOn: false },
    jobMinutes,
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const showTimes = allowTimes && state.crew.length >= 2;
  const windowOf = (id: string): CrewWindow =>
    state.windows[id] ?? wholeVisit(jobMinutes);

  function setWindow(id: string, patch: Partial<CrewWindow>) {
    onChange((s) => ({
      ...s,
      windows: {
        ...s.windows,
        [id]: { ...(s.windows[id] ?? wholeVisit(jobMinutes)), ...patch },
      },
    }));
  }

  return (
    <>
      <FormField label="Crew" htmlFor="crew" error={error}>
        {people.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active employees yet.</p>
        ) : (
          <>
            <div id="crew" className="flex flex-wrap gap-2" role="group" aria-label="Crew">
              {people.map((p) => {
                const on = state.crew.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange((s) => toggleCrewMember(s, p.id))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground",
                    )}
                  >
                    {on ? "✓ " : ""}
                    {p.label}
                    {p.hasAccommodations && (
                      <AlertTriangle
                        className="ml-1 inline-block h-3 w-3 align-[-1px] text-amber-600 dark:text-amber-400"
                        aria-label="Has accommodations on file"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {state.crew.length === 0
                ? "Nobody yet — leave it empty to keep the job unassigned."
                : `${state.crew.length} on this job. Everyone picked is on it equally; tap again to remove.`}
            </p>
          </>
        )}

        {/* What the server reads. Same fields as before the picker existed:
            first person as assigned_to (being phased out), the rest as
            additional_assignees, per-person times as splits. */}
        <input type="hidden" name="assigned_to" value={fields.assignedTo} />
        {fields.additional.map((id) => (
          <input key={id} type="hidden" name="additional_assignees" value={id} />
        ))}
        {fields.splits && <input type="hidden" name="splits" value={fields.splits} />}
      </FormField>

      {showTimes && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={state.timesOn}
              onChange={(e) => {
                const on = e.target.checked;
                onChange((s) => ({ ...s, timesOn: on }));
              }}
              className="h-4 w-4 rounded border-input"
            />
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Different times for each person</span>
          </label>
          <p className="-mt-1 pl-7 text-xs text-muted-foreground">
            Leave off when everyone works the whole visit together. Turn on to give
            each person their own start and length — they can overlap, hand off, or
            leave a gap.
          </p>

          {state.timesOn && (
            <div className="space-y-2.5 pt-1">
              {state.crew.map((id, idx) => {
                const w = windowOf(id);
                const clock = formatSegmentWindow(
                  scheduledAtLocal,
                  w.start_offset_minutes,
                  w.duration_minutes,
                );
                return (
                  <div key={id} className="space-y-2 rounded-md border border-border bg-card p-3">
                    <p className="text-sm font-medium">
                      {byId.get(id)?.label ?? "Unknown"}
                      {clock && (
                        <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
                          {clock}
                        </span>
                      )}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <HourMinuteField
                        key={`${id}-start`}
                        label="Starts after job start"
                        ariaPrefix={`Person ${idx + 1} start`}
                        valueMinutes={w.start_offset_minutes}
                        onChangeMinutes={(start_offset_minutes) =>
                          setWindow(id, { start_offset_minutes })
                        }
                      />
                      <HourMinuteField
                        key={`${id}-duration`}
                        label="Time on site"
                        ariaPrefix={`Person ${idx + 1} duration`}
                        valueMinutes={w.duration_minutes}
                        onChangeMinutes={(duration_minutes) =>
                          setWindow(id, { duration_minutes })
                        }
                      />
                    </div>
                  </div>
                );
              })}

              {(() => {
                const resolved = resolveSegmentWindows(
                  state.crew.map((id) => ({ assigned_to: id, ...windowOf(id) })),
                );
                const labour = resolved.reduce((n, s) => n + s.duration_minutes, 0);
                const span = segmentsSpanMinutes(resolved);
                return (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      Hours worked: <strong>{minutesLabel(labour)}</strong> across{" "}
                      {state.crew.length} people
                    </p>
                    {/* With overlap these differ, and it's the span that has to
                        match the job's own length — summing the labour would
                        overstate how long the job runs. */}
                    <p>
                      Job runs: <strong>{minutesLabel(span)}</strong>{" "}
                      {segmentsOverlap(resolved) ? "— some people overlap" : "— no overlap"}
                    </p>
                    {span > 0 && jobMinutes > 0 && span !== jobMinutes && (
                      <p className="text-amber-600 dark:text-amber-400">
                        That doesn&rsquo;t match the job&rsquo;s length of{" "}
                        {minutesLabel(jobMinutes)}. Check the Duration field above.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </>
  );
}
