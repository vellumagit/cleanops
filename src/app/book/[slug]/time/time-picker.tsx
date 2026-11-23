"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Turnstile } from "@/components/turnstile";
import { bookTimeAction, openTimesAction, type BookState, type TimesState } from "./actions";

const empty: BookState = {};
type Service = { id: string; name: string; length: string; price: string | null };
type Day = TimesState["days"][number];
type Picked = { at: number; label: string; day: string };

/**
 * "Book a clean": one question a screen, one big button each. What would
 * you like, which day, what time, who are you. Made for a phone and for
 * someone who doesn't book things online often.
 *
 * Every time shown came from the server, and the save checks it again.
 */
export function TimePicker({
  slug,
  companyName,
  phone,
  services,
  held,
  button,
  turnstileSiteKey,
  preview,
}: {
  slug: string;
  companyName: string;
  phone: string | null;
  services: Service[];
  /** The office confirms each booking: the time is held, not confirmed. */
  held: boolean;
  button: { backgroundColor: string; color: string; borderColor: string };
  turnstileSiteKey: string | null;
  preview: boolean;
}) {
  const only = services.length === 1 ? services[0] : null;
  const [service, setService] = useState<Service | null>(only);
  const [days, setDays] = useState<Day[]>([]);
  const [nextFrom, setNextFrom] = useState<string | null>(null);
  const [timesError, setTimesError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [day, setDay] = useState<Day | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, book, booking] = useActionState(bookTimeAction, empty);
  const [human, setHuman] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  function load(s: Service, from: string | null, keep: Day[]) {
    startLoading(async () => {
      const res = await openTimesAction(slug, s.id, from);
      setTimesError(res.error ?? null);
      setDays([...keep, ...res.days]);
      setNextFrom(res.nextFrom);
      setLoaded(true);
    });
  }
  function choose(s: Service) {
    setService(s);
    setDay(null);
    setPicked(null);
    setLoaded(false);
    load(s, null, []);
  }
  // One service on the page: straight to the days.
  useEffect(() => {
    if (only) load(only, null, []);
    // Once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The time went while they were typing: back to fresh times.
  useEffect(() => {
    if (state.taken && service) {
      setPicked(null);
      setDay(null);
      setLoaded(false);
      load(service, null, []);
    }
    // Only when a save comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // Each step starts at the top of the card, not wherever the last one was scrolled to.
  useEffect(() => {
    top.current?.scrollIntoView({ block: "start" });
  }, [service, day, picked, state.done]);

  const big = "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3 text-left text-lg font-semibold transition-colors hover:bg-muted";
  const field = "h-12 w-full rounded-xl border border-input bg-background px-4 text-base";
  const label = "block text-base font-medium";
  const back = "text-base font-medium underline underline-offset-4";
  const call = phone ? (
    <>
      {" "}
      Or call {companyName} at{" "}
      <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-semibold underline underline-offset-4">
        {phone}
      </a>
      .
    </>
  ) : null;

  if (state.done) {
    return (
      <div ref={top} role="status" data-testid="booked" className="scroll-mt-6 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-base text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
        {state.done.held ? (
          <>
            <p className="text-xl font-semibold">{companyName} is holding your time.</p>
            <p className="mt-1 text-lg">{state.done.when}</p>
            <p className="mt-2">It isn&rsquo;t confirmed yet. You&rsquo;ll get an email as soon as {companyName} confirms it.</p>
          </>
        ) : (
          <>
            <p className="text-xl font-semibold">You&rsquo;re booked.</p>
            <p className="mt-1 text-lg">{state.done.when}</p>
            <p className="mt-2">{companyName} will see you then. A confirmation is on its way to your email.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={top} className="scroll-mt-6 space-y-4">
      {preview && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          This is a preview. You can look through the times, but nothing is booked.
        </p>
      )}

      {/* 1. What would you like? */}
      {!service && (
        <section aria-labelledby="step-service">
          <h2 id="step-service" className="text-xl font-semibold">
            What would you like?
          </h2>
          <ul className="mt-3 space-y-2">
            {services.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => choose(s)} className={big}>
                  <span className="min-w-0">
                    <span className="block [overflow-wrap:anywhere]">{s.name}</span>
                    <span className="block text-sm font-normal text-muted-foreground">{s.length}</span>
                  </span>
                  {s.price && <span className="shrink-0 tabular-nums">{s.price}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. Which day? */}
      {service && !day && (
        <section aria-labelledby="step-day">
          <h2 id="step-day" className="text-xl font-semibold">
            Which day?
          </h2>
          <p className="mt-1 text-base text-muted-foreground">
            {service.name}, {service.length}.
          </p>
          {state.taken && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              Someone just took that time. Here is what&rsquo;s open now.
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
                      <span className="shrink-0 text-sm font-normal text-muted-foreground">
                        {d.times.length === 1 ? "1 time" : `${d.times.length} times`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {days.length === 0 && !timesError && (
                <p className="mt-3 text-base">
                  {nextFrom ? "Nothing is open in the next two weeks." : "There are no open times right now."}
                  {!nextFrom && call}
                </p>
              )}
              {nextFrom && (
                <button type="button" disabled={loading} onClick={() => load(service, nextFrom, days)} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-5 text-base font-semibold hover:bg-muted disabled:opacity-60">
                  {loading ? "Looking…" : "Show later days"}
                </button>
              )}
            </>
          )}
          {!only && (
            <p className="mt-4">
              <button type="button" onClick={() => setService(null)} className={back}>
                Back
              </button>
            </p>
          )}
        </section>
      )}

      {/* 3. What time? */}
      {service && day && !picked && (
        <section aria-labelledby="step-time">
          <h2 id="step-time" className="text-xl font-semibold">
            What time?
          </h2>
          <p className="mt-1 text-base text-muted-foreground">{day.label}. This is when we arrive.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="open-times">
            {day.times.map((t) => (
              <li key={t.at}>
                <button
                  type="button"
                  onClick={() => setPicked({ at: t.at, label: t.label, day: day.label })}
                  className="flex min-h-14 w-full items-center justify-center rounded-xl border border-border bg-card px-3 text-lg font-semibold tabular-nums hover:bg-muted"
                >
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

      {/* 4. Your details. */}
      {service && day && picked && (
        <form action={book} className="space-y-4" aria-labelledby="step-details">
          <h2 id="step-details" className="text-xl font-semibold">
            Your details
          </h2>
          <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-base" data-testid="picked-summary">
            <span className="font-semibold">{service.name}</span>
            <br />
            {picked.day} at {picked.label}
          </p>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="service_id" value={service.id} />
          <input type="hidden" name="at" value={picked.at} />
          {/* Not for people. A script that fills every field fills this one. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>

          {state.error && (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
              {state.error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="book-address" className={label}>
              Address of the place to clean
            </label>
            <input id="book-address" name="address" required autoComplete="street-address" maxLength={300} className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="book-name" className={label}>
              Your name
            </label>
            <input id="book-name" name="name" required autoComplete="name" maxLength={200} className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="book-email" className={label}>
              Your email
            </label>
            <input id="book-email" name="email" type="email" inputMode="email" required autoComplete="email" maxLength={254} className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="book-phone" className={label}>
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input id="book-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="book-notes" className={label}>
              Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea id="book-notes" name="notes" maxLength={1000} rows={3} className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base" placeholder="Pets, parking, how to get in…" />
          </div>

          {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onToken={setHuman} />}
          {human && <input type="hidden" name="cf-turnstile-response" value={human} />}

          <button
            type="submit"
            disabled={booking || preview || (Boolean(turnstileSiteKey) && !human)}
            style={{ ...button, borderWidth: 1, borderStyle: "solid" }}
            className="flex min-h-14 w-full items-center justify-center rounded-xl px-5 text-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {booking ? "Booking…" : held ? "Ask for this time" : "Book this clean"}
          </button>
          <p className="text-sm text-muted-foreground">
            {held
              ? `${companyName} holds this time for you and confirms it by email.`
              : `This books your clean with ${companyName}. You'll get a confirmation by email.`}
          </p>
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
