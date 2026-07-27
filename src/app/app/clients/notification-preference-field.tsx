"use client";

import { useState } from "react";
import {
  summarizeClientChannels,
  summarizeActualChannels,
  CATEGORY_CHANNELS,
  type ActualChannels,
  type CategoryChannel,
  type ClientContactPreference,
  type ContactOverrides,
  type NotificationCategory,
  type OrgContactDefault,
  type ResolvedChannels,
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

function describe(
  actual: ActualChannels,
  raw: ResolvedChannels,
  category: NotificationCategory,
): string {
  if (actual.email && actual.sms) return "email + text";
  if (actual.email) return "email";
  if (actual.sms) return "text";
  if (actual.reason === "channel_not_available") {
    return raw.sms && !CATEGORY_CHANNELS[category].sms
      ? "nothing (these are email-only)"
      : "nothing (texting isn't set up)";
  }
  if (actual.reason === "sms_not_opted_in")
    return "nothing (not opted in to texts)";
  if (actual.reason === "no_email_address")
    return "nothing (no email on file)";
  return "nothing";
}

export function NotificationPreferenceField({
  defaultPreference,
  defaultOverrides,
  orgDefault,
  hasEmail,
  smsOptedIn,
  smsEnabled = true,
}: {
  defaultPreference?: string | null;
  defaultOverrides?: ContactOverrides | null;
  orgDefault: OrgContactDefault;
  hasEmail: boolean;
  smsOptedIn: boolean;
  /** organizations.sms_enabled — with it off, every text silently skips. */
  smsEnabled?: boolean;
}) {
  const [mode, setMode] = useState<ClientContactPreference>(
    (defaultPreference as ClientContactPreference) ?? "inherit",
  );
  const [overrides, setOverrides] = useState<ContactOverrides>(
    defaultOverrides ?? {},
  );

  const resolveInput = {
    orgDefault,
    clientPref: mode,
    overrides,
    hasEmail,
    smsOptedIn,
  };
  // raw = what the client is willing to receive; preview = what actually
  // sends once channel capability and the org SMS switch are applied.
  const rawPreview = summarizeClientChannels(resolveInput);
  const preview = summarizeActualChannels(resolveInput, {
    smsAvailable: smsEnabled,
  });

  // Warn when a chosen channel can't actually deliver — silence should never
  // be a surprise. Effective channel per category = custom override, else the
  // org default.
  const effectiveChannel = (cat: NotificationCategory): string => {
    const ch = mode === "custom" ? (overrides[cat] ?? "inherit") : "inherit";
    return ch === "inherit" ? orgDefault : ch;
  };
  const textWanted = (cat: NotificationCategory) =>
    ["sms", "both"].includes(effectiveChannel(cat));

  const wantsSmsWithoutConsent =
    smsEnabled &&
    !smsOptedIn &&
    mode !== "do_not_contact" &&
    CATEGORIES.some((c) => CATEGORY_CHANNELS[c.key].sms && textWanted(c.key));
  const smsNotSetUp =
    !smsEnabled &&
    mode !== "do_not_contact" &&
    CATEGORIES.some((c) => CATEGORY_CHANNELS[c.key].sms && textWanted(c.key));
  const emailOnlyWithText =
    mode !== "do_not_contact" &&
    CATEGORIES.some((c) => !CATEGORY_CHANNELS[c.key].sms && textWanted(c.key));

  function setCategory(cat: NotificationCategory, ch: CategoryChannel) {
    setOverrides((prev) => ({ ...prev, [cat]: ch }));
  }

  return (
    <div id="notifications" className="scroll-mt-24 rounded-lg border border-border bg-card p-4">
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
                    const wantsSms = ch.key === "sms" || ch.key === "both";
                    const wantsEmail = ch.key === "email" || ch.key === "both";
                    // Same dead-segment honesty as the per-client manager:
                    // no text version > org SMS off > no consent > no email.
                    const deadReason =
                      wantsSms && !CATEGORY_CHANNELS[c.key].sms
                        ? ch.key === "sms"
                          ? "These messages are email-only — no text versions exist"
                          : "These messages are email-only — “Both” sends just the email"
                        : wantsSms && !smsEnabled
                          ? "Texting isn't turned on for your business yet"
                          : wantsSms && !smsOptedIn
                            ? "Client hasn't opted in to SMS — texts won't send until they do"
                            : wantsEmail && !hasEmail
                              ? "No email on file"
                              : null;
                    return (
                      <button
                        key={ch.key}
                        type="button"
                        title={deadReason ?? undefined}
                        onClick={() => setCategory(c.key, ch.key)}
                        className={`border-l border-border px-2.5 py-1.5 text-[11px] first:border-l-0 transition-colors ${
                          active
                            ? "bg-foreground font-medium text-background"
                            : "text-muted-foreground hover:bg-muted"
                        } ${deadReason && !active ? "opacity-50" : ""}`}
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
      {smsNotSetUp && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Texting isn&apos;t turned on for your business yet — text choices stay
          silent until you set it up.
        </p>
      )}
      {emailOnlyWithText && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Billing and review messages are email-only — &ldquo;Text&rdquo; there
          sends nothing, and &ldquo;Both&rdquo; sends just the email.
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
                  {describe(preview[c.key], rawPreview[c.key], c.key)}
                </strong>
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
