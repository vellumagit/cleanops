"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Ban, Search } from "lucide-react";
import { setClientNotificationPrefsAction } from "./actions";

/**
 * PER-CLIENT MODE manager — the primary surface for Route B. One row per
 * client with the three category channels + a "no contact" switch, saving on
 * change. Linked from each client's profile card for quick access.
 *
 * Unconfigured (inherit) clients receive NOTHING in this mode, so the empty
 * state of a row is honest: "No messages".
 */

export type MatrixClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  sms_opted_in: boolean | null;
  contact_preference: string | null;
  contact_overrides: Record<string, string> | null;
};

const CATEGORIES = [
  { key: "booking", label: "Booking" },
  { key: "billing", label: "Billing" },
  { key: "growth", label: "Reviews" },
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
};

export function ClientAutomationMatrix({ rows }: { rows: MatrixClientRow[] }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          preference: r.contact_preference ?? "inherit",
          overrides: r.contact_overrides ?? {},
        },
      ]),
    ),
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
    startTransition(() => {
      setClientNotificationPrefsAction(fd);
    });
  }

  function setChannel(clientId: string, cat: string, channel: string) {
    const cur = state[clientId] ?? { preference: "inherit", overrides: {} };
    save(clientId, {
      preference: "custom",
      overrides: { ...cur.overrides, [cat]: channel },
    });
  }

  function toggleDnc(clientId: string) {
    const cur = state[clientId] ?? { preference: "inherit", overrides: {} };
    save(clientId, {
      preference: cur.preference === "do_not_contact" ? "custom" : "do_not_contact",
      overrides: cur.overrides,
    });
  }

  const configured = Object.values(state).filter(
    (s) =>
      s.preference === "do_not_contact" ||
      (s.preference === "custom" &&
        Object.values(s.overrides).some((v) => v !== "off" && v !== "inherit")),
  ).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <p className="text-sm font-semibold">Client-by-client messages</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            In per-client mode this list is the authority: a client receives
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
          const s = state[r.id] ?? { preference: "inherit", overrides: {} };
          const isDnc = s.preference === "do_not_contact";
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <Link
                  href={`/app/clients/${r.id}`}
                  className="truncate text-sm font-medium hover:underline underline-offset-2"
                >
                  {r.name}
                </Link>
                <p className="truncate text-[11px] text-muted-foreground">
                  {r.email ?? "no email"}
                  {r.phone
                    ? r.sms_opted_in
                      ? " · texts ok"
                      : " · not opted in to texts"
                    : ""}
                </p>
              </div>

              {!isDnc &&
                CATEGORIES.map((c) => {
                  const current = s.overrides[c.key] ?? "off";
                  return (
                    <div key={c.key} className="flex items-center gap-1.5">
                      <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
                        {c.label}
                      </span>
                      <div className="flex overflow-hidden rounded-md border border-border">
                        {CHANNELS.map((ch) => {
                          const active = current === ch.key;
                          const smsDead =
                            (ch.key === "sms" || ch.key === "both") &&
                            !r.sms_opted_in;
                          return (
                            <button
                              key={ch.key}
                              type="button"
                              disabled={pending}
                              title={
                                smsDead
                                  ? "Client hasn't opted in to SMS — texts won't send until they do"
                                  : undefined
                              }
                              onClick={() => setChannel(r.id, c.key, ch.key)}
                              className={`border-l border-border px-2 py-1 text-[10px] first:border-l-0 transition-colors ${
                                active
                                  ? "bg-foreground font-medium text-background"
                                  : "text-muted-foreground hover:bg-muted"
                              } ${smsDead && !active ? "opacity-50" : ""}`}
                            >
                              {ch.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

              {isDnc && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-700 dark:text-red-400">
                  <Ban className="h-3 w-3" /> No contact
                </span>
              )}

              <button
                type="button"
                disabled={pending}
                onClick={() => toggleDnc(r.id)}
                className={`shrink-0 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                  isDnc
                    ? "border-border text-muted-foreground hover:bg-muted"
                    : "border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                }`}
              >
                {isDnc ? "Allow contact" : "Do not contact"}
              </button>
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
