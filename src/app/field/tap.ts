"use client";

import { toast } from "sonner";
import { startJobAction, completeJobAction } from "./jobs/actions";
import { TAPPED_AT_FIELD, MAX_TAP_AGE_MS } from "@/lib/punch-time";

/**
 * The two things a cleaner says about her own shift — "I'm here" and
 * "I'm done" — and what happens when the phone can't reach the server.
 *
 * Township Road 522 is rural. A tap that fails on one bar used to vanish
 * with a toast, and the cleaner either tapped again later (recording the
 * wrong time) or assumed it had worked. Now every tap carries the phone's
 * time, and one that can't be sent is kept on the phone and sent as soon
 * as there's signal, with the time she actually tapped.
 */

export type TapKind = "here" | "done";

type QueuedTap = {
  kind: TapKind;
  bookingId: string;
  tappedAt: string;
  lat: number | null;
  lng: number | null;
};

const KEY = "sollos.field.taps";

function readQueue(): QueuedTap[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedTap[]) : [];
  } catch {
    return [];
  }
}
function writeQueue(q: QueuedTap[]) {
  try {
    if (q.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // Private mode or storage blocked: the tap still went out normally.
  }
}

export function queuedTapCount(): number {
  return readQueue().length;
}

async function getCoords(): Promise<{ lat: number | null; lng: number | null }> {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    return { lat: null, lng: null };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}

function toFormData(t: QueuedTap): FormData {
  const fd = new FormData();
  fd.set("booking_id", t.bookingId);
  fd.set(TAPPED_AT_FIELD, t.tappedAt);
  if (t.lat != null) fd.set("lat", String(t.lat));
  if (t.lng != null) fd.set("lng", String(t.lng));
  return fd;
}

/** A failure to reach the server at all, as opposed to the server saying no. */
function isNetworkFailure(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|load failed|connection/i.test(msg);
}

async function send(t: QueuedTap): Promise<{ ok: true } | { ok: false; error: string }> {
  const fd = toFormData(t);
  return t.kind === "here" ? startJobAction(fd) : completeJobAction(fd);
}

export type TapOutcome =
  | { status: "sent" }
  | { status: "refused"; error: string }
  | { status: "queued" };

/**
 * Record a tap. Sends it now; if the server can't be reached, keeps it and
 * says so. Location is best-effort and never delays the tap by more than
 * five seconds.
 */
export async function tap(kind: TapKind, bookingId: string): Promise<TapOutcome> {
  const tappedAt = new Date().toISOString();
  const coords = await getCoords();
  const t: QueuedTap = { kind, bookingId, tappedAt, ...coords };
  try {
    const result = await send(t);
    if (result.ok) {
      // A tap that got through makes any earlier, stuck copy of the same
      // tap redundant — sending it later would clock her in a second time.
      writeQueue(readQueue().filter((q) => !(q.bookingId === bookingId && q.kind === kind)));
      return { status: "sent" };
    }
    return { status: "refused", error: result.error };
  } catch (err) {
    if (!isNetworkFailure(err)) {
      return { status: "refused", error: err instanceof Error ? err.message : "Something went wrong." };
    }
    writeQueue([...readQueue(), t]);
    return { status: "queued" };
  }
}

let flushing = false;

/**
 * Send whatever is waiting, oldest first, stopping at the first tap that
 * still can't get through. A tap the server refuses is dropped and shown,
 * not retried forever.
 */
export async function flushTaps(opts: { quiet?: boolean } = {}): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    let q = readQueue();
    while (q.length > 0) {
      const t = q[0];
      // Too old to trust: the server would record it as "now", which is the
      // wrong time with the right name on it. Say so instead.
      if (Date.now() - new Date(t.tappedAt).getTime() > MAX_TAP_AGE_MS) {
        q = q.slice(1);
        writeQueue(q);
        if (!opts.quiet) {
          toast.error(
            `A saved "${t.kind === "here" ? "I'm here" : "I'm done"}" from more than 12 hours ago couldn't be sent. Tell your manager the real time.`,
          );
        }
        continue;
      }
      try {
        const result = await send(t);
        q = q.slice(1);
        writeQueue(q);
        if (result.ok) {
          sent++;
          if (!opts.quiet) {
            // Her phone's zone on purpose: this is the time she saw when
            // she tapped, on the device she tapped it on.
            const at = new Date(t.tappedAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            toast.success(
              t.kind === "here"
                ? `Sent: you arrived at ${at}`
                : `Sent: you finished at ${at}`,
            );
          }
        } else if (!opts.quiet) {
          toast.error(
            `Couldn't record "${t.kind === "here" ? "I'm here" : "I'm done"}": ${result.error}`,
          );
        }
      } catch (err) {
        if (isNetworkFailure(err)) break;
        q = q.slice(1);
        writeQueue(q);
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
