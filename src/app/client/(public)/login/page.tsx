import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientAuthState } from "@/lib/client-auth";
import { ClientLoginForm } from "./login-form";
import { ClientDoor, DoorNote } from "../door";

export const metadata = { title: "See your cleans" };

function safePortalNext(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/client/")) return null;
  if (raw.includes("//") || raw.includes("\\")) return null;
  if (/%2f|%5c/i.test(raw)) return null;
  if (!/^[A-Za-z0-9/_.~-]+$/.test(raw)) return null;
  return raw;
}

/** What a link that didn't work says, by the reason the link page gave. */
const LINK_NOTES: Record<string, string> = {
  expired: "That button has already been used, or is more than an hour old. Ask for a new one below; it only takes a moment.",
  "no-client":
    "That email isn't on a cleaner's list any more. If that seems wrong, call your cleaner and ask them to check the email they have for you.",
  wait: "That's a lot of tries. Wait a few minutes, then ask for a new link below.",
};

/**
 * The client's way in: their email, one button (./login-form.tsx).
 *
 * Standalone, without the client area's tab bar.
 */
export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; link?: string; auth_error?: string }>;
}) {
  const { next: rawNext, link, auth_error: authError } = await searchParams;
  // Only a plain path inside the client area.
  const next = safePortalNext(rawNext);

  const state = await getClientAuthState();
  if (state.status === "ok") redirect(next ?? "/client");
  // Signed in with a login no client record points at yet, on the way to an
  // invite link: go back to it, which connects the two.
  if (state.status === "not-a-client" && next) redirect(next);

  const note = (link && LINK_NOTES[link]) || (authError ? LINK_NOTES.expired : null);

  return (
    <ClientDoor title="See your cleans" lede="Your visits, your invoices, and a way to ask for a clean.">
      <div className="space-y-4">
        {note && <DoorNote>{note}</DoorNote>}
        {/* Signed in as someone who isn't a client (staff, most often). The
            form below still works: the link signs this browser in as the
            client. Saying who they are now saves a confused minute. */}
        {state.status === "not-a-client" && (
          <DoorNote>
            You&rsquo;re signed in{state.email ? <> as <strong className="[overflow-wrap:anywhere]">{state.email}</strong></> : null},
            which isn&rsquo;t a client login. To see your cleans, type the email your cleaner has for you.
          </DoorNote>
        )}
        <ClientLoginForm next={next} />
      </div>
      <p className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
        Work for the cleaning company?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Staff sign-in
        </Link>
      </p>
    </ClientDoor>
  );
}
