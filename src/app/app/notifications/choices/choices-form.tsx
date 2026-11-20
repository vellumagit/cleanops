"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { OFFICE_TOPICS, type OfficeTopic } from "@/lib/notification-topics";
import { saveMyNotificationChoicesAction, type NotificationChoicesState } from "./actions";

const empty: NotificationChoicesState = {};

/**
 * One tick per topic: ticked means "alert me". The ticks are the state, so
 * what is on screen is exactly what Save posts.
 */
export function NotificationChoicesForm({ muted }: { muted: OfficeTopic[] }) {
  const [state, formAction] = useActionState(saveMyNotificationChoicesAction, empty);
  const [alerting, setAlerting] = useState<Set<OfficeTopic>>(
    () => new Set(OFFICE_TOPICS.map((t) => t.key).filter((k) => !muted.includes(k))),
  );

  useEffect(() => {
    if (state.ok) toast.success("Saved");
  }, [state]);

  const toggle = (key: OfficeTopic, on: boolean) =>
    setAlerting((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const quiet = OFFICE_TOPICS.length - alerting.size;

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <FormError message={state.error} />

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {OFFICE_TOPICS.map((t) => {
          const on = alerting.has(t.key);
          return (
            <li key={t.key}>
              <label className="flex cursor-pointer items-start gap-3 p-4">
                <input
                  type="checkbox"
                  name="alert"
                  value={t.key}
                  checked={on}
                  onChange={(e) => toggle(t.key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t.label}
                    {!on && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Quiet
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        {quiet === 0
          ? "You are alerted about everything."
          : `${quiet} ${quiet === 1 ? "topic is" : "topics are"} quiet: no phone alert or email for ${quiet === 1 ? "it" : "them"}. You will still find ${quiet === 1 ? "it" : "them"} under the bell.`}
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}
