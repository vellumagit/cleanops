"use client";

import { useActionState, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import { askForCleanAction, type AskState } from "./actions";

const empty: AskState = {};

/**
 * "Ask for a clean": the one form on a company's booking page. Large fields
 * and one button, for a phone and for someone who doesn't fill in forms
 * often. What happens to it is in ./actions.ts.
 */
export function AskForm({
  slug,
  companyName,
  services,
  button,
  turnstileSiteKey,
  disabledReason,
}: {
  slug: string;
  companyName: string;
  services: Array<{ id: string; name: string }>;
  button: { backgroundColor: string; color: string; borderColor: string };
  turnstileSiteKey: string | null;
  /** Set on a preview: the form shows, and says why it won't send. */
  disabledReason?: string | null;
}) {
  const [state, send, sending] = useActionState(askForCleanAction, empty);
  const [human, setHuman] = useState<string | null>(null);
  const [service, setService] = useState(services[0]?.id ?? "other");
  const waiting = Boolean(turnstileSiteKey) && !human;

  if (state.ok) {
    return (
      <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-base text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
        <p className="text-lg font-semibold">Thank you. {companyName} has your request.</p>
        <p className="mt-1">Someone will be in touch to confirm a time and a price. Nothing is booked yet.</p>
      </div>
    );
  }

  const field = "h-12 w-full rounded-xl border border-input bg-background px-4 text-base";
  const label = "block text-base font-medium";

  return (
    <form action={send} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
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
      {disabledReason && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {disabledReason}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="ask-service" className={label}>
          What would you like?
        </label>
        {services.length > 0 && (
          <select id="ask-service" name="service_id" value={service} onChange={(e) => setService(e.target.value)} className={field}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="other">Something else</option>
          </select>
        )}
        {(services.length === 0 || service === "other") && (
          <input
            id={services.length === 0 ? "ask-service" : "ask-service-other"}
            name="service_other"
            required
            maxLength={300}
            placeholder="A regular house clean, a move-out clean…"
            aria-label="What you would like cleaned"
            className={field}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="ask-date" className={label}>
            A day that suits you
          </label>
          <input id="ask-date" name="preferred_date" type="date" className={field} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ask-window" className={label}>
            Time of day
          </label>
          <select id="ask-window" name="preferred_time_window" defaultValue="flexible" className={field}>
            <option value="flexible">Any time</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ask-address" className={label}>
          Address of the place to clean
        </label>
        <input id="ask-address" name="address" autoComplete="street-address" maxLength={300} className={field} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ask-notes" className={label}>
          Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea id="ask-notes" name="notes" maxLength={1000} rows={3} className="w-full rounded-xl border border-input bg-background px-4 py-3 text-base" placeholder="Pets, how many bedrooms, parking…" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="ask-name" className={label}>
            Your name
          </label>
          <input id="ask-name" name="name" required autoComplete="name" maxLength={200} className={field} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ask-phone" className={label}>
            Phone <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id="ask-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} className={field} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="ask-email" className={label}>
          Your email
        </label>
        <input id="ask-email" name="email" type="email" inputMode="email" required autoComplete="email" maxLength={254} className={field} />
      </div>

      {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onToken={setHuman} />}
      {human && <input type="hidden" name="cf-turnstile-response" value={human} />}

      <button
        type="submit"
        disabled={sending || waiting || Boolean(disabledReason)}
        style={{ ...button, borderWidth: 1, borderStyle: "solid" }}
        className="flex min-h-14 w-full items-center justify-center rounded-xl px-5 text-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {sending ? "Sending…" : "Send my request"}
      </button>
      <p className="text-sm text-muted-foreground">
        This asks {companyName} for a clean. It doesn&rsquo;t book one: they&rsquo;ll reply to confirm a time and a
        price.
      </p>
    </form>
  );
}
