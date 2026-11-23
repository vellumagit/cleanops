"use server";

import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { visitByToken } from "@/lib/visit-link";
import { askToMoveVisit, leaveVisitNote, skipVisit, type ClientJobActionState } from "@/lib/client-visit-requests";
import { moveVisit, visitOpenTimes } from "@/lib/visit-move";
import type { PublicDay } from "@/lib/online-booking";

/**
 * What a client can do from the private link in a booking email, with no
 * sign-in: leave a note, ask to move the visit, cancel it. The same rules
 * as the signed-in client area (lib/client-visit-requests.ts); the link is
 * what proves the visit is theirs, so every action starts by resolving it.
 */
async function linked(formData: FormData) {
  // A read that fails stops here; it is not taken for "no such visit".
  enterFailClosed();
  const limit = await checkIpRateLimit("visit-link-act", 20, 10 * 60_000);
  if (!limit.allowed) return { error: "That's a lot of tries. Wait a few minutes and try again, or call us." } as const;
  const visit = await visitByToken(String(formData.get("token") ?? ""));
  if (!visit) return { error: "This link has stopped working. Call us and we'll help." } as const;
  return { visit, client: { id: visit.client.id, name: visit.client.name } } as const;
}

export async function visitNoteAction(_prev: ClientJobActionState, formData: FormData): Promise<ClientJobActionState> {
  const found = await linked(formData);
  if ("error" in found) return { error: found.error };
  return leaveVisitNote(found.client, found.visit, String(formData.get("body") ?? ""));
}

export async function visitMoveAction(_prev: ClientJobActionState, formData: FormData): Promise<ClientJobActionState> {
  const found = await linked(formData);
  if ("error" in found) return { error: found.error };
  return askToMoveVisit(found.client, found.visit, String(formData.get("wish") ?? ""));
}

export async function visitCancelAction(_prev: ClientJobActionState, formData: FormData): Promise<ClientJobActionState> {
  const found = await linked(formData);
  if ("error" in found) return { error: found.error };
  return skipVisit(found.client, found.visit, String(formData.get("reason") ?? ""));
}

export type VisitTimesState = { days: PublicDay[]; nextFrom: string | null; error?: string };

/** The open times this visit could move to (lib/visit-move.ts). */
export async function visitTimesAction(token: string, fromYmd: string | null): Promise<VisitTimesState> {
  enterFailClosed();
  const none = (error: string): VisitTimesState => ({ days: [], nextFrom: null, error });
  const limit = await checkIpRateLimit("visit-link-times", 60, 60_000);
  if (!limit.allowed) return none("That's a lot of looking. Wait a minute and try again.");
  const visit = await visitByToken(String(token ?? ""));
  if (!visit) return none("This link has stopped working. Call us and we'll help.");
  const from = fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd) ? fromYmd : undefined;
  const res = await visitOpenTimes(visit, from);
  if (!res.ok) return none(res.error);
  return { days: res.days, nextFrom: res.nextFrom };
}

export type VisitMoveState = { moved?: { when: string }; taken?: boolean; error?: string };

/** Move the visit to a time the client picked from that list. */
export async function visitMoveToAction(_prev: VisitMoveState, formData: FormData): Promise<VisitMoveState> {
  const found = await linked(formData);
  if ("error" in found) return { error: found.error };
  const res = await moveVisit(found.client, found.visit, Number(formData.get("at")));
  if (!res.ok) return res.taken ? { taken: true } : { error: res.error };
  return { moved: { when: res.when } };
}
