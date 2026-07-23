"use client";

import { useState } from "react";
import {
  summarizeClientChannels,
  type CategoryChannel,
  type ClientContactPreference,
  type ContactOverrides,
  type NotificationCategory,
  type OrgContactDefault,
} from "@/lib/notification-preferences";

/**
 * Per-client notification control. Shows the whole decision on one screen:
 * the org default it inherits, a three-way master (follow / custom / do not
 * contact), a per-category channel picker, the SMS-consent state, and a plain
 * "what actually sends" summary so the owner reads the OUTCOME, not the knobs.
 *
 * Submits two hidden fields: contact_preference + contact_overrides (JSON).
 */

const MODES: Array<{
  key: ClientContactPreference;
  label: string;
  hint: string;
}> = [
  { key: "inherit", label: "Follow default", hint: "Use the org setting" },
  { key: "custom", label: "Custom", hint: "Pick per type" },
  { key: "do_not_contact", label: "Do not contact", hint: "Nothing, ever" },
];

const CATEGORIES: Array<{
  key: NotificationCategory;
  label: string;
  hint: string;
}> = [
  { key: "booking", label: "Booking updates", hint: "confirmations, reminders, changes" },
  { key: "billing", label: "Billing", hint: "invoices, receipts, overdue" },
  { key: "growth", label: "Reviews & rebooking", hint: "follow-ups" },
];

const CHANNELS: Array<{ key: CategoryChannel; label: string }> = [
  { key: "off", label: "Off" },
  { key: "email", label: "Email" },
  { key: "sms", label: "Text" },
  { key: "both", label: "Both" },
];

const ORG_DEFAULT_LABEL: Record<OrgContactDefault, string> = {
  email: "Email only",
  sms: "Text only",
  both: "Email + text",
  none: "No notifications",
};

function describe(r: { email: boolean; sms: boolean; reason: string }): string {
  if (r.email && r.sms) return "email + text";
  if (r.email) return "email";
  if (r.sms) return "text";
  if (r.reason === "sms_not_opted_in") return "nothing (not opted in to texts)";
  if (r.reason === "no_email_address") return "nothing (no email on file)";
  return "nothing";
}

export function NotificationPreferenceField({
  defaultPreference,
  defaultOverrides,
  orgDefault,
  hasEmail,
  smsOptedIn,
}: {
  defaultPreference?: string | null;
  defaultOverrides?: ContactOverrides | null;
  orgDefault: OrgContactDefault;
  hasEmail: boolean;
  smsOptedIn: boolean;
}) {
  const [mode, setMode] = useState<ClientContactPreference>(
    (defaultPreference as ClientContactPreference) ?? "inherit",
  );
  const [overrides, setOverrides] = useState<ContactOverrides>(
    defaultOverrides ?? {},
  );

  const preview = summarizeClientChannels({
    orgDefault,
    clientPref: mode,
    overrides,
    hasEmail,
    smsOptedIn,
  });

  // Warn when a chosen channel can't actually deliver — the owner picked Text
  // for someone who never opted in, which would silently send nothing.
  const wantsSmsWithoutConsent =
    !smsOptedIn &&
    mode !== "do_not_contact" &&
    CATEGORIES.some((c) => {
      const ch =
        mode === "custom" ? (overrides[c.key] ?? "inherit") : "inherit";
      const eff = ch === "inherit" ? orgDefault : ch;
      return eff === "sms" || eff === "both";
    });

  function setCategory(cat: NotificationCategory, ch: CategoryChannel) {
    setOverrides((prev) => ({ ...prev, [cat]: ch }));
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="contact_preference" value={mode} />
      <input
        type="hidden"
        name="contact_overrides"
        value={JSON.stringify(overrides)}
      />

      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">Notifications</p>
        <p className="text-xs text-muted-foreground">
          Org default: {ORG_DEFAULT_LABEL[orgDefault]}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {MODES.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-md border px-2 py-2 text-center text-xs transition-colors ${
                active
                  ? m.key === "do_not_contact"
                    ? "border-red-500 bg-red-500/10 font-medium text-red-700 dark:text-red-300"
                    : "border-foreground bg-muted font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className="block">{m.label}</span>
              <span className="mt-0.5 block text-[10px] opacity-70">
                {m.hint}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "custom" && (
        <div className="mt-4 space-y-2.5">
          {CATEGORIES.map((c) => {
            const current = overrides[c.key] ?? "inherit";
            return (
              <div
                key={c.key}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0 text-xs">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className="ml-1.5 text-muted-foreground">{c.hint}</span>
                </div>
                <div className="flex overflow-hidden rounded-md border border-border">
                  {CHANNELS.map((ch) => {
                    const active =
                      current === ch.key ||
                      (current === "inherit" && ch.key === "off" && false);
                    return (
                      <button
                        key={ch.key}
                        type="button"
                        onClick={() => setCategory(c.key, ch.key)}
                        className={`border-l border-border px-2.5 py-1.5 text-[11px] first:border-l-0 transition-colors ${
                          active
                            ? "bg-foreground font-medium text-background"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            A type you don&apos;t set follows the org default.
          </p>
        </div>
      )}

      {wantsSmsWithoutConsent && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Texts are selected, but this client hasn&apos;t opted in to SMS — so no
          text will send. Send them an opt-in request from the client page first.
        </p>
      )}

      <div className="mt-3 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        {mode === "do_not_contact" ? (
          <span>
            This client receives <strong className="font-medium">no automated messages</strong>.
          </span>
        ) : (
          <span>
            Sends —{" "}
            {CATEGORIES.map((c, i) => (
              <span key={c.key}>
                {i > 0 ? " · " : ""}
                {c.label.toLowerCase()}:{" "}
                <strong className="font-medium text-foreground">
                  {describe(preview[c.key])}
                </strong>
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
