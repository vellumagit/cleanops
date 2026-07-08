"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  MessageSquare,
  Phone,
  TriangleAlert,
  Gift,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  enableSmsAction,
  disableSmsAction,
  saveCapAction,
  type SmsSettingsFormState,
} from "./actions";

const empty: SmsSettingsFormState = {};

export type SmsSettingsProps = {
  enabled: boolean;
  number: string | null;
  simulated: boolean;
  twilioLive: boolean;
  capDollars: number;
  canEnable: boolean;
  usage: {
    usedSegments: number;
    includedSegments: number;
    overageSegments: number;
    overageCents: number;
    isComped: boolean;
  };
};

export function SmsSettingsForm(props: SmsSettingsProps) {
  const [enableState, enableAction] = useActionState(enableSmsAction, empty);
  const [disableState, disableAction] = useActionState(disableSmsAction, empty);
  const [capState, capAction] = useActionState(saveCapAction, empty);

  if (!props.enabled) {
    return (
      <div className="max-w-lg space-y-5">
        <FormError message={enableState.errors?._form} />

        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium">Text your clients automatically</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Booking confirmations and reminders sent by text</li>
            <li>From your own dedicated number — not a shared line</li>
            <li>
              Included in your plan up to a monthly limit; only heavy usage costs
              extra, and it&apos;s capped
            </li>
          </ul>
        </div>

        {!props.canEnable ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your subscription is inactive.{" "}
              <Link href="/app/settings/billing" className="underline">
                Start a plan
              </Link>{" "}
              to enable SMS.
            </span>
          </div>
        ) : (
          <form action={enableAction}>
            <SubmitButton pendingLabel="Setting up your number…">
              <MessageSquare className="mr-1.5 h-4 w-4" />
              Enable SMS
            </SubmitButton>
          </form>
        )}
      </div>
    );
  }

  const { usage } = props;
  const pct =
    usage.includedSegments > 0
      ? Math.min(100, Math.round((usage.usedSegments / usage.includedSegments) * 100))
      : 0;
  const overBar = usage.overageSegments > 0;

  return (
    <div className="max-w-lg space-y-8">
      {/* Number */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Phone className="h-4 w-4" />
          Your texting number
        </div>
        <p className="mt-1 font-mono text-lg">{props.number ?? "—"}</p>
        {props.simulated && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Test number — Twilio isn&apos;t live yet, so no real texts send. A
            real number is assigned automatically once Twilio is connected.
          </p>
        )}
      </div>

      {/* Usage meter */}
      <section>
        <h2 className="text-sm font-semibold">This month&apos;s usage</h2>
        {usage.isComped ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            <Gift className="h-3.5 w-3.5" />
            Complimentary account — texting is free, never billed.
          </p>
        ) : null}
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>
              {usage.usedSegments} / {usage.includedSegments} included
            </span>
            {overBar && !usage.isComped && (
              <span className="text-amber-700 dark:text-amber-300">
                +{usage.overageSegments} overage · $
                {(usage.overageCents / 100).toFixed(2)}
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={
                overBar
                  ? "h-full bg-amber-500"
                  : "h-full bg-emerald-500"
              }
              style={{ width: `${overBar ? 100 : pct}%` }}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Each text is 1 segment (long messages count as 2+). Segments beyond
          your included allotment are billed at 3¢ each, up to your cap below.
        </p>
      </section>

      {/* Overage cap */}
      {!usage.isComped && (
        <section className="border-t border-border pt-6">
          <h2 className="text-sm font-semibold">Monthly overage cap</h2>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
            SMS pauses automatically once overage charges reach this amount, so
            you never get a surprise bill. It resumes next month.
          </p>
          <form action={capAction} className="space-y-4">
            <FormError message={capState.errors?._form} />
            {capState.success && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cap saved.
              </div>
            )}
            <FormField label="Cap (USD / month)" htmlFor="cap_dollars" error={capState.errors?.cap}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  id="cap_dollars"
                  name="cap_dollars"
                  type="number"
                  min="0"
                  step="1"
                  className="max-w-[8rem]"
                  defaultValue={String(props.capDollars)}
                />
              </div>
            </FormField>
            <SubmitButton pendingLabel="Saving…">Save cap</SubmitButton>
          </form>
        </section>
      )}

      {/* Consent note */}
      <section className="border-t border-border pt-6">
        <h2 className="text-sm font-semibold">Consent (CASL)</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You may only text clients who have consented. Sollos sends
          client-facing texts only to clients marked <em>opted in to SMS</em> on
          their profile, and every message includes a &quot;Reply STOP to opt
          out&quot; footer. Manage consent on each{" "}
          <Link href="/app/clients" className="underline">
            client
          </Link>
          .
        </p>
      </section>

      {/* Disable */}
      <section className="border-t border-border pt-6">
        <FormError message={disableState.errors?._form} />
        <form action={disableAction}>
          <SubmitButton pendingLabel="Turning off…" variant="outline">
            Turn off SMS
          </SubmitButton>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Stops all texting and stops overage billing. Your number is kept so you
          can turn it back on later.
        </p>
      </section>
    </div>
  );
}
