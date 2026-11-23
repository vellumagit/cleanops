import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendOrgEmail } from "@/lib/email";
import { getOrgName } from "@/lib/org-name";
import { ensureLogin, mintSignInToken, openSession, scramblePassword } from "@/lib/client-sign-in-session";

/**
 * How a client gets in (docs/online-booking-roadmap.md, "How a client gets
 * in"): they type their email, get one button by email, press it, and are in
 * their client area. No password, and no invite first.
 *
 * Until 2026-11-22 a client could only sign in after the office pressed
 * Invite and the client then chose a password. Anyone else typed their email
 * and nothing happened.
 *
 * THE RULE: being on a company's books with an email, and proving you can
 * read that email, is the permission. Proof is pressing a one-time link we
 * sent to it. Nothing here trusts an email that was merely typed or merely
 * registered.
 *
 * Two things follow from that rule:
 *
 * - The client record is connected to a login only in completeClientSignIn,
 *   in the same request that just spent a link sent to that address. Never
 *   from "a login with this email exists".
 * - Anyone can register any address with the auth server before the real
 *   person ever shows up, and pick a password for it. So the first time a
 *   login that isn't staff is connected to a client, its password is
 *   replaced with one nobody knows. The real person gets in by link; whoever
 *   registered first is left with a password that opens nothing.
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com").replace(/\/$/, "");

type ClientRow = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  profile_id: string | null;
  created_at: string;
};

/** ilike is an exact match only once its wildcards are escaped. */
const exactIlike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Everyone on any company's books with this email, oldest first. Archived
 *  clients are out: archiving is the lock on a client's access. */
async function clientsWithEmail(admin: Admin, email: string): Promise<ClientRow[]> {
  const { data, error } = (await admin
    .from("clients")
    .select("id, organization_id, name, email, profile_id, created_at")
    .ilike("email", exactIlike(email))
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(20)) as unknown as { data: ClientRow[] | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data ?? [];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The email with the one button. Branded as the cleaner, not as Sollos. */
export function signInEmail(args: { name: string; companyName: string; link: string }) {
  const first = args.name.trim().split(/\s+/)[0] || "there";
  return {
    subject: `Your link to ${args.companyName}`,
    html: `
      <p style="font-size:16px;">Hi ${escapeHtml(first)},</p>
      <p style="font-size:16px;">Press the button to see your cleans with ${escapeHtml(args.companyName)}.</p>
      <p><a href="${args.link}" style="display:inline-block;padding:14px 28px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Open my cleans</a></p>
      <p style="color:#666;font-size:13px;">The button works once, for the next hour. If it has stopped working, ask for a new one at ${siteUrl()}/client/login.</p>
      <p style="color:#666;font-size:13px;">Didn't ask for this? You can ignore it. Nobody can get in without this email.</p>
    `,
    text: `Hi ${first},

Open this link to see your cleans with ${args.companyName}:
${args.link}

It works once, for the next hour. If it has stopped working, ask for a new one at ${siteUrl()}/client/login.

Didn't ask for this? You can ignore it. Nobody can get in without this email.`,
  };
}

/**
 * Send the sign-in link, if this email is on anyone's books. Says nothing
 * about whether it was: the caller shows the same "check your email" either
 * way, so the page can't be used to find out who a company's clients are.
 */
export async function sendClientSignInLink(emailTyped: string): Promise<void> {
  const email = emailTyped.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return;

  const admin = createSupabaseAdminClient();
  const rows = await clientsWithEmail(admin, email);
  if (rows.length === 0) return;
  // The record this login already opens, if there is one; otherwise the
  // oldest. The email is from that company.
  const client = rows.find((r) => r.profile_id) ?? rows[0];

  const login = await ensureLogin(admin, email, client.name);
  if (!login.ok) return;
  const token = await mintSignInToken(admin, email);
  if (!token) return;

  const mail = signInEmail({
    name: client.name,
    companyName: await getOrgName(client.organization_id),
    link: `${siteUrl()}/client/enter?t=${encodeURIComponent(token)}`,
  });
  // Asked for by the person themselves, so the platform's "pause client
  // emails" switch doesn't hold it back.
  await sendOrgEmail(client.organization_id, { to: email, toName: client.name, pauseExempt: true, ...mail });
}

export type SignInResult = { ok: true } | { ok: false; reason: "expired" | "no-client" };

/**
 * The button in the email was pressed. Spend the token, which signs this
 * browser in, and connect the login to the client record with that email.
 *
 * `clientId` narrows the connection to one record (the invite link names its
 * client); without it, the oldest record on the books with this email.
 */
export async function completeClientSignIn(tokenHash: string, clientId?: string): Promise<SignInResult> {
  if (!tokenHash || tokenHash.length < 16 || tokenHash.length > 200) return { ok: false, reason: "expired" };
  const session = await openSession(tokenHash);
  if (!session) return { ok: false, reason: "expired" };

  const admin = createSupabaseAdminClient();
  const rows = (await clientsWithEmail(admin, session.email)).filter((r) => !clientId || r.id === clientId);

  // Already connected: nothing to do but go in.
  if (rows.some((r) => r.profile_id === session.userId)) return { ok: true };
  // One login opens one client record (getCurrentClient reads exactly one).
  const { data: mine } = (await admin
    .from("clients")
    .select("id")
    .eq("profile_id", session.userId)
    .is("archived_at", null)
    .limit(1)) as unknown as { data: Array<{ id: string }> | null };
  if (mine && mine.length > 0) return { ok: true };

  const free = rows.find((r) => !r.profile_id);
  if (!free) return { ok: false, reason: "no-client" };

  // First connection. A login that isn't staff may have been registered by
  // anyone, with a password of their choosing: make that password useless
  // before the record is opened to it. Staff keep theirs; an invited member
  // of a company is not a stranger, and scrambling would lock them out of
  // their work.
  const { data: staff } = (await admin
    .from("memberships")
    .select("id")
    .eq("profile_id", session.userId)
    .limit(1)) as unknown as { data: Array<{ id: string }> | null };
  if (!staff || staff.length === 0) await scramblePassword(admin, session.userId);

  const { data: linked, error } = (await admin
    .from("clients")
    .update({
      profile_id: session.userId,
      portal_invite_token: null,
      portal_invite_expires_at: null,
      portal_accepted_at: new Date().toISOString(),
    } as never)
    .eq("id", free.id)
    .is("profile_id", null)
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  // Lost a race to another press of the same link: whoever won is this
  // same login, so going in is still right.
  if (!linked?.length) {
    const again = await clientsWithEmail(admin, session.email);
    return again.some((r) => r.profile_id === session.userId) ? { ok: true } : { ok: false, reason: "no-client" };
  }
  return { ok: true };
}

/**
 * The invite link (clients/portal-actions invitePortalAction) pressed by its
 * client: sign them straight in. The invite proves the same thing a sign-in
 * link does, since it was sent to the client's own address, so it is turned
 * into one on the spot.
 */
export async function signInFromInvite(client: { id: string; name: string; email: string }): Promise<SignInResult> {
  const admin = createSupabaseAdminClient();
  const email = client.email.trim().toLowerCase();
  const login = await ensureLogin(admin, email, client.name);
  if (!login.ok) return { ok: false, reason: "expired" };
  const token = await mintSignInToken(admin, email);
  if (!token) return { ok: false, reason: "expired" };
  return completeClientSignIn(token, client.id);
}
