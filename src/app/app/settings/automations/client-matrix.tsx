"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Ban, ChevronDown, Search, TriangleAlert } from "lucide-react";
import {
  NOTIFICATION_EVENTS,
  CATEGORY_CHANNELS,
  resolveClientChannels,
  actualClientChannels,
  type NotificationEvent,
  type ResolveInput,
} from "@/lib/notification-preferences";
import { setClientNotificationPrefsAction } from "./actions";

/**
 * PER-CLIENT MODE manager — Route B's authority surface.
 *
 * Collapsed rows read as one-line summaries; expanding a client reveals:
 *   1. Quick setup — one-tap presets for that client
 *   2. The three category channel pickers
 *   3. "Advanced automations" — an explicit per-client disclosure that
 *      reveals per-message mutes (category picks the channel; a mute turns
 *      off just that one message for just that client)
 *
 * Everything saves on change into clients.contact_overrides (whitelisted
 * server-side). Unconfigured clients receive NOTHING in this mode.
 */

export type MatrixClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  sms_opted_in: boolean | null;
  contact_preference: string | null;
  contact_overrides: Record<string, unknown> | null;
};

const CATEGORIES = [
  { key: "booking", label: "Booking updates" },
  { key: "billing", label: "Billing" },
  { key: "growth", label: "Reviews & rebooking" },
] as const;

const CHANNELS = [
  { key: "off", label: "Off" },
  { key: "email", label: "Email" },
  { key: "sms", label: "Text" },
  { key: "both", label: "Both" },
] as const;

type RowState = {
  preference: string;
  overrides: Record<string, string>;
  muted: NotificationEvent[];
  advanced: boolean;
};

function parseRow(r: MatrixClientRow): RowState {
  const ov = (r.contact_overrides ?? {}) as Record<string, unknown>;
  return {
    preference: r.contact_preference ?? "inherit",
    overrides: Object.fromEntries(
      CATEGORIES.map((c) => [
        c.key,
        typeof ov[c.key] === "string" ? (ov[c.key] as string) : "off",
      ]),
    ),
    muted: Array.isArray(ov.muted_events)
      ? (ov.muted_events as NotificationEvent[])
      : [],
    advanced: ov.advanced === true,
  };
}

/**
 * Run the REAL send-time resolver against the draft state, so everything this
 * panel displays is what will actually happen — not what the switches say.
 * The matrix only renders in per-client mode, where the org default is a hard
 * "none" (unconfigured = silent), so orgDefault is fixed here by design.
 */
function resolveFor(
  r: MatrixClientRow,
  s: RowState,
  category: (typeof CATEGORIES)[number]["key"],
  event?: NotificationEvent,
) {
  return resolveClientChannels({
    orgDefault: "none",
    clientPref: s.preference as ResolveInput["clientPref"],
    overrides: {
      ...s.overrides,
      muted_events: s.muted,
    } as ResolveInput["overrides"],
    category,
    event,
    hasEmail: Boolean(r.email),
    smsOptedIn: Boolean(r.sms_opted_in),
  });
}

/**
 * What actually goes out for one category: the resolver's answer intersected
 * with channel capability (billing and growth are email-only — there are no
 * text versions of an invoice or review ask) AND the org's own SMS master
 * switch — the engine silently skips every text while sms_enabled is off.
 */
function actualForCategory(
  r: MatrixClientRow,
  s: RowState,
  category: (typeof CATEGORIES)[number]["key"],
  smsEnabled: boolean,
): { label: string | null; partial: boolean } {
  const res = actualClientChannels(
    {
      orgDefault: "none",
      clientPref: s.preference as ResolveInput["clientPref"],
      overrides: {
        ...s.overrides,
        muted_events: s.muted,
      } as ResolveInput["overrides"],
      category,
      hasEmail: Boolean(r.email),
      smsOptedIn: Boolean(r.sms_opted_in),
    },
    { smsAvailable: smsEnabled },
  );
  const label =
    res.email && res.sms
      ? "Email + text"
      : res.email
        ? "Email"
        : res.sms
          ? "Text"
          : null;
  const desired = s.overrides[category] ?? "off";
  // partial = something they asked for can't deliver (e.g. "Both" on an
  // email-only category, or texts without opt-in / org SMS off).
  const wantsEmail = desired === "email" || desired === "both";
  const wantsSms = desired === "sms" || desired === "both";
  const partial =
    label !== null && ((wantsEmail && !res.email) || (wantsSms && !res.sms));
  return { label, partial };
}

export function ClientAutomationMatrix({
  rows,
  smsEnabled,
}: {
  rows: MatrixClientRow[];
  /** organizations.sms_enabled — with it off, every text silently skips. */
  smsEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, parseRow(r)])),
  );
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function save(clientId: string, next: RowState) {
    setState((prev) => ({ ...prev, [clientId]: next }));
    const fd = new FormData();
    fd.set("client_id", clientId);
    fd.set("contact_preference", next.preference);
    for (const c of CATEGORIES) {
      fd.set(`override_${c.key}`, next.overrides[c.key] ?? "off");
    }
    fd.set("muted_events", JSON.stringify(next.muted));
    fd.set("advanced", next.advanced ? "true" : "false");
    startTransition(() => {
      setClientNotificationPrefsAction(fd);
    });
  }

  function summaryFor(r: MatrixClientRow): {
    text: string;
    tone: "muted" | "normal" | "warn" | "danger";
  } {
    const s = state[r.id] ?? parseRow(r);
    if (s.preference === "do_not_contact") {
      return { text: "No contact", tone: "danger" };
    }
    const anyOn =
      s.preference === "custom" &&
      CATEGORIES.some(
        (c) => s.overrides[c.key] && s.overrides[c.key] !== "off",
      );
    if (!anyOn) return { text: "Not configured — no messages", tone: "muted" };
    // The summary states what will ACTUALLY send (resolver + channel
    // capability), not what the switches say — a text-only pick with no
    // opt-in reads "won't send", never "Text".
    let blocked = false;
    const parts = CATEGORIES.map((c) => {
      const short = c.label.split(" ")[0];
      const desired = s.overrides[c.key] ?? "off";
      if (desired === "off") return `${short}: Off`;
      const actual = actualForCategory(r, s, c.key, smsEnabled);
      if (!actual.label) {
        blocked = true;
        return `${short}: won't send`;
      }
      if (actual.partial) blocked = true;
      return `${short}: ${actual.label}${actual.partial ? " ⚠" : ""}`;
    });
    const mutes = s.muted.length > 0 ? ` · ${s.muted.length} muted` : "";
    return {
      text: parts.join(" · ") + mutes,
      tone: blocked ? "warn" : "normal",
    };
  }

  const configured = rows.filter((r) => {
    const s = state[r.id] ?? parseRow(r);
    return (
      s.preference === "do_not_contact" ||
      (s.preference === "custom" &&
        CATEGORIES.some((c) => s.overrides[c.key] && s.overrides[c.key] !== "off"))
    );
  }).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <p className="text-sm font-semibold">Client-by-client messages</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This list is the authority in per-client mode: a client receives
            only what you switch on here. {configured} of {rows.length}{" "}
            configured — the rest get nothing.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            className="h-8 rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <ul className="divide-y divide-border">
        {filtered.map((r) => {
          const s = state[r.id] ?? parseRow(r);
          const isOpen = openId === r.id;
          const isDnc = s.preference === "do_not_contact";
          const summary = summaryFor(r);
          return (
            <li key={r.id}>
              {/* Collapsed row — a readable sentence, not a wall of buttons. */}
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : r.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {r.name}
                </span>
                <span
                  className={`hidden truncate text-xs sm:block ${
                    summary.tone === "danger"
                      ? "text-red-600 dark:text-red-400"
                      : summary.tone === "warn"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {summary.text}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-border bg-muted/20 px-4 py-4">
                  <p className="text-[11px] text-muted-foreground">
                    <Link
                      href={`/app/clients/${r.id}`}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Open profile
                    </Link>
                    {" · "}
                    {r.email ?? "no email"}
                    {r.phone
                      ? r.sms_opted_in
                        ? " · texts ok"
                        : " · not opted in to texts"
                      : " · no phone"}
                  </p>

                  {/* 1 · Quick setup */}
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick setup
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        {
                          label: "Everything",
                          apply: () =>
                            save(r.id, {
                              ...s,
                              preference: "custom",
                              overrides: {
                                booking: "email",
                                billing: "email",
                                growth: "email",
                              },
                              muted: [],
                            }),
                        },
                        {
                          label: "Essentials only",
                          apply: () =>
                            save(r.id, {
                              ...s,
                              preference: "custom",
                              overrides: {
                                booking: "email",
                                billing: "email",
                                growth: "off",
                              },
                              muted: [],
                            }),
                        },
                        {
                          label: "Nothing",
                          apply: () =>
                            save(r.id, {
                              ...s,
                              preference: "custom",
                              overrides: {
                                booking: "off",
                                billing: "off",
                                growth: "off",
                              },
                              muted: [],
                            }),
                        },
                      ].map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          disabled={pending || isDnc}
                          onClick={q.apply}
                          className="rounded-full border border-border bg-background px-3 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
                        >
                          {q.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          save(r.id, {
                            ...s,
                            preference: isDnc ? "custom" : "do_not_contact",
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-[11px] ${
                          isDnc
                            ? "border-border bg-background text-muted-foreground hover:bg-muted"
                            : "border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                        }`}
                      >
                        {isDnc ? "Allow contact again" : "Do not contact"}
                      </button>
                    </div>
                  </div>

                  {!isDnc && (
                    <>
                      {/* 2 · Category channels */}
                      <div>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          How they hear from you
                        </p>
                        <div className="space-y-2">
                          {CATEGORIES.map((c) => {
                            const current = s.overrides[c.key] ?? "off";
                            const cap = CATEGORY_CHANNELS[c.key];
                            return (
                              <div
                                key={c.key}
                                className="flex flex-wrap items-center justify-between gap-2"
                              >
                                <span className="text-xs font-medium">
                                  {c.label}
                                </span>
                                <div className="flex overflow-hidden rounded-md border border-border">
                                  {CHANNELS.map((ch) => {
                                    const active = current === ch.key;
                                    const wantsSms =
                                      ch.key === "sms" || ch.key === "both";
                                    const wantsEmail =
                                      ch.key === "email" || ch.key === "both";
                                    // A segment is "dead" when picking it can't
                                    // fully deliver. Precedence: no text version
                                    // exists > org SMS off > no consent > no
                                    // email on file.
                                    const deadReason = wantsSms && !cap.sms
                                      ? ch.key === "sms"
                                        ? "These messages are email-only — no text versions exist"
                                        : "These messages are email-only — “Both” sends just the email"
                                      : wantsSms && !smsEnabled
                                        ? "Texting isn't turned on for your business yet — text choices stay silent until you set it up"
                                        : wantsSms && !r.sms_opted_in
                                          ? "Client hasn't opted in to SMS — texts won't send until they do"
                                          : wantsEmail && !r.email
                                            ? "No email on file — add one on their profile"
                                            : null;
                                    return (
                                      <button
                                        key={ch.key}
                                        type="button"
                                        disabled={pending}
                                        title={deadReason ?? undefined}
                                        onClick={() =>
                                          save(r.id, {
                                            ...s,
                                            preference: "custom",
                                            overrides: {
                                              ...s.overrides,
                                              [c.key]: ch.key,
                                            },
                                          })
                                        }
                                        className={`border-l border-border px-2.5 py-1 text-[11px] first:border-l-0 transition-colors ${
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
                        </div>

                        {/* Honesty line — selected channels that can't deliver,
                            spelled out instead of silently not sending. */}
                        {(() => {
                          const warnings: string[] = [];
                          if (s.preference === "custom") {
                            const first = r.name.split(" ")[0];
                            const on = CATEGORIES.filter(
                              (c) => (s.overrides[c.key] ?? "off") !== "off",
                            );
                            const textCapableWithSms = on.some(
                              (c) =>
                                CATEGORY_CHANNELS[c.key].sms &&
                                ["sms", "both"].includes(
                                  s.overrides[c.key] ?? "off",
                                ),
                            );
                            if (
                              on.some((c) =>
                                ["email", "both"].includes(
                                  s.overrides[c.key] ?? "off",
                                ),
                              ) &&
                              !r.email
                            ) {
                              warnings.push(
                                `No email on file — email messages stay silent until you add one to ${first}'s profile.`,
                              );
                            }
                            if (textCapableWithSms && !smsEnabled) {
                              warnings.push(
                                "Texting isn't turned on for your business yet — text choices stay silent until you set it up in Settings.",
                              );
                            }
                            if (
                              textCapableWithSms &&
                              smsEnabled &&
                              !r.sms_opted_in
                            ) {
                              warnings.push(
                                `Texts are selected but ${first} hasn't opted in — texts stay silent until they do.`,
                              );
                            }
                            const emailOnlyOnSms = on.filter(
                              (c) =>
                                !CATEGORY_CHANNELS[c.key].sms &&
                                (s.overrides[c.key] ?? "off") === "sms",
                            );
                            if (emailOnlyOnSms.length > 0) {
                              warnings.push(
                                `${emailOnlyOnSms
                                  .map((c) => c.label)
                                  .join(
                                    " and ",
                                  )} messages are email-only — a “Text” setting leaves them silent.`,
                              );
                            }
                            const emailOnlyOnBoth = on.filter(
                              (c) =>
                                !CATEGORY_CHANNELS[c.key].sms &&
                                (s.overrides[c.key] ?? "off") === "both",
                            );
                            if (emailOnlyOnBoth.length > 0) {
                              warnings.push(
                                `${emailOnlyOnBoth
                                  .map((c) => c.label)
                                  .join(
                                    " and ",
                                  )} messages are email-only — “Both” sends just the email.`,
                              );
                            }
                          }
                          if (warnings.length === 0) return null;
                          return (
                            <div className="mt-2 space-y-1">
                              {warnings.map((w) => (
                                <p
                                  key={w}
                                  className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                                >
                                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span>{w}</span>
                                </p>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {/* 3 · Advanced automations — explicit per-client disclosure */}
                      <div className="border-t border-border pt-3">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={s.advanced}
                            disabled={pending}
                            onChange={() =>
                              save(r.id, {
                                ...s,
                                advanced: !s.advanced,
                                // Turning advanced OFF clears the mutes — no
                                // invisible state left behind.
                                muted: s.advanced ? [] : s.muted,
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-input"
                          />
                          <span className="text-xs font-medium">
                            Advanced automations
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            fine-tune individual messages for {r.name.split(" ")[0]}
                          </span>
                        </label>

                        {s.advanced && (
                          <div className="mt-2.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                            {NOTIFICATION_EVENTS.map((ev) => {
                              const categoryChannel =
                                s.overrides[ev.category] ?? "off";
                              const categoryOff = categoryChannel === "off";
                              const isMuted = s.muted.includes(ev.id);
                              // What will ACTUALLY go out for this one message:
                              // the resolver's answer intersected with the
                              // channels this message exists on.
                              const res = resolveFor(r, s, ev.category, ev.id);
                              const email =
                                res.email && ev.channels.includes("email");
                              const sms =
                                res.sms &&
                                ev.channels.includes("sms") &&
                                smsEnabled;
                              const actual =
                                email && sms
                                  ? "Email + text"
                                  : email
                                    ? "Email"
                                    : sms
                                      ? "Text"
                                      : null;
                              const blockedReason =
                                !categoryOff && !isMuted && !actual
                                  ? res.sms && !ev.channels.includes("sms")
                                    ? "This message is email-only — the category is set to Text"
                                    : res.sms && !smsEnabled
                                      ? "Texting isn't turned on for your business yet"
                                      : res.reason === "sms_not_opted_in"
                                        ? "Client hasn't opted in to texts"
                                        : res.reason === "no_email_address"
                                          ? "No email on file"
                                          : "No usable channel for this client"
                                  : null;
                              return (
                                <button
                                  key={ev.id}
                                  type="button"
                                  disabled={pending || categoryOff}
                                  onClick={() =>
                                    save(r.id, {
                                      ...s,
                                      muted: isMuted
                                        ? s.muted.filter((m) => m !== ev.id)
                                        : [...s.muted, ev.id],
                                    })
                                  }
                                  title={
                                    categoryOff
                                      ? "The whole category is off for this client"
                                      : isMuted
                                        ? "Muted for this client — click to restore"
                                        : (blockedReason ??
                                          "Sends via the category channel — click to mute just this message")
                                  }
                                  className="flex items-center justify-between rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                                >
                                  <span
                                    className={
                                      categoryOff || isMuted
                                        ? "text-muted-foreground"
                                        : ""
                                    }
                                  >
                                    {ev.label}
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      categoryOff
                                        ? "text-muted-foreground/60"
                                        : isMuted
                                          ? "text-muted-foreground"
                                          : actual
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-amber-700 dark:text-amber-400"
                                    }`}
                                  >
                                    {categoryOff
                                      ? "Off via category"
                                      : isMuted
                                        ? "Muted"
                                        : (actual ?? "Won't send")}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {isDnc && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Ban className="h-3.5 w-3.5 text-red-500" />
                      No automated messages of any kind. You can still email or
                      text them manually.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            No clients match.
          </li>
        )}
      </ul>
    </div>
  );
}
