"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { visitMoveToAction, visitTimesAction, type VisitMoveState, type VisitTimesState } from "../actions";

const empty: VisitMoveState = {};
type Day = VisitTimesState["days"][number];

/**
 * Move a visit to another time: which day, what time, then one button that
 * says exactly what will happen. Nothing changes until that button.
 */
export function MovePicker({
  token,
  companyName,
  current,
  button,
}: {
  token: string;
  companyName: string;
  /** "Wednesday, March 3 at 9:00 AM": when it is booked for now. */
  current: string;
  button: { backgroundColor: string; color: string; borderColor: string };
}) {
  const [days, setDays] = useState<Day[]>([]);
  const [nextFrom, setNextFrom] = useState<string | null>(null);
  const [timesError, setTimesError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [day, setDay] = useState<Day | null>(null);
  const [picked, setPicked] = useState<{ at: number; label: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, move, moving] = useActionState(visitMoveToAction, empty);
  const top = useRef<HTMLDivElement>(null);

  function load(from: string | null, keep: Day[]) {
    startLoading(async () => {
      const res = await visitTimesAction(token, from);
      setTimesError(res.error ?? null);
      setDays([...keep, ...res.days]);
      setNextFrom(res.nextFrom);
      setLoaded(true);
    });
  }
  useEffect(() => {
    load(null, []);
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The time went while they were deciding: back to fresh times.
  useEffect(() => {
    if (state.taken) {
      setPicked(null);
      setDay(null);
      setLoaded(false);
      load(null, []);
    }
    // Only when a save comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [day, picked, state.moved]);

  const big = "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3 text-left text-lg font-semibold transition-colors hover:bg-muted";
  const back = "text-base font-medium underline underline-offset-4";

  if (state.moved) {
    return (
      <div ref={top} className="scroll-mt-6 space-y-4">
        <div role="status" data-testid="moved" className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-base text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="text-xl font-semibold">Your clean is moved.</p>
          <p className="mt-1 text-lg">{state.moved.when}</p>
          <p className="mt-2">{companyName} has been told.</p>
        </div>
        <Link href={`/v/${token}`} className="flex min-h-14 w-full items-center justify-center rounded-xl border border-border px-5 text-lg font-semibold hover:bg-muted">
          See my clean
        </Link>
      </div>
    );
  }

  return (
    <div ref={top} className="scroll-mt-6 space-y-4">
      <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-base">
        <span className="text-sm text-muted-foreground">Booked for now</span>
        <br />
        <span className="font-semibold">{current}</span>
      </p>

      {!day && (
        <section aria-labelledby="move-day">
          <h2 id="move-day" className="text-xl font-semibold">
            Which day instead?
          </h2>
          {state.taken && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              That time has just gone. Your clean is still booked as it was. Here is what&rsquo;s open now.
            </p>
          )}
          {timesError && (
            <p role="alert" className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
              {timesError}
            </p>
          )}
          {!loaded ? (
            <p className="mt-3 text-base text-muted-foreground">Looking for open days…</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2" data-testid="open-days">
                {days.map((d) => (
                  <li key={d.ymd}>
                    <button type="button" onClick={() => setDay(d)} className={big} data-day={d.ymd}>
                      <span>{d.label}</span>
                      <span className="shrink-0 text-sm font-normal text-muted-foreground">{d.times.length === 1 ? "1 time" : `${d.times.length} times`}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {days.length === 0 && !timesError && (
                <p className="mt-3 text-base">
                  {nextFrom ? "Nothing else is open in the next two weeks." : `There are no other open times right now. Call ${companyName} and they'll help.`}
                </p>
              )}
              {nextFrom && !timesError && (
                <button type="button" disabled={loading} onClick={() => load(nextFrom, days)} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-5 text-base font-semibold hover:bg-muted disabled:opacity-60">
                  {loading ? "Looking…" : "Show later days"}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {day && !picked && (
        <section aria-labelledby="move-time">
          <h2 id="move-time" className="text-xl font-semibold">
            What time?
          </h2>
          <p className="mt-1 text-base text-muted-foreground">{day.label}. This is when we arrive.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="open-times">
            {day.times.map((t) => (
              <li key={t.at}>
                <button type="button" onClick={() => setPicked({ at: t.at, label: t.label })} className="flex min-h-14 w-full items-center justify-center rounded-xl border border-border bg-card px-3 text-lg font-semibold tabular-nums hover:bg-muted">
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <button type="button" onClick={() => setDay(null)} className={back}>
              Back
            </button>
          </p>
        </section>
      )}

      {day && picked && (
        <form action={move} className="space-y-4" aria-labelledby="move-confirm">
          <h2 id="move-confirm" className="text-xl font-semibold">
            Move it to this time?
          </h2>
          <p className="rounded-xl border border-border px-4 py-3 text-lg font-semibold" data-testid="move-summary">
            {day.label} at {picked.label}
          </p>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="at" value={picked.at} />
          {state.error && (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
              {state.error}
            </div>
          )}
          <button
            type="submit"
            disabled={moving}
            style={{ ...button, borderWidth: 1, borderStyle: "solid" }}
            className="flex min-h-14 w-full items-center justify-center rounded-xl px-5 text-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {moving ? "Moving…" : "Yes, move my clean"}
          </button>
          <p className="text-sm text-muted-foreground">The same cleaner comes. Nothing changes until you press the button.</p>
          <p>
            <button type="button" onClick={() => setPicked(null)} className={back}>
              Back
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
