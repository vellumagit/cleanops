import "server-only";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The `state` for the Google Calendar OAuth flow.
 *
 * It used to be the bare membership id (prefixed "mbr:" for a cleaner's own
 * calendar), with a cookie holding the same id. A membership id is not a
 * secret: a teammate or ex-employee who knew an owner's could set the cookie
 * by hand, finish the flow with their OWN Google account, and receive every
 * job the company books. The same worked against a cleaner's calendar.
 *
 * Now the state is a sealed token only this server can make: who started the
 * flow, for which calendar, and when it lapses, encrypted and authenticated
 * with the integration key (AES-GCM, lib/crypto). A forged or edited state
 * doesn't open; a real one is good for ten minutes and names one membership.
 * No table needed, unlike the QuickBooks and Sage states.
 */

export type GcalStateScope = "org" | "member";

const TTL_MS = 10 * 60 * 1000;

type Sealed = { s: GcalStateScope; m: string; e: number; n: string };

export function issueGcalOAuthState(scope: GcalStateScope, membershipId: string): string {
  const sealed: Sealed = {
    s: scope,
    m: membershipId,
    e: Date.now() + TTL_MS,
    n: randomBytes(12).toString("base64url"),
  };
  const token = encryptSecret(JSON.stringify(sealed));
  if (!token) throw new Error("Could not seal the Google Calendar OAuth state");
  return token;
}

/** Who a state was issued to, or null if it is forged, edited or lapsed. */
export function readGcalOAuthState(
  state: string | null | undefined,
): { scope: GcalStateScope; membershipId: string } | null {
  if (!state) return null;
  try {
    const opened = decryptSecret(state);
    if (!opened) return null;
    const v = JSON.parse(opened) as Partial<Sealed>;
    if ((v.s !== "org" && v.s !== "member") || typeof v.m !== "string" || typeof v.e !== "number") return null;
    if (v.e < Date.now()) return null;
    return { scope: v.s, membershipId: v.m };
  } catch {
    return null;
  }
}
