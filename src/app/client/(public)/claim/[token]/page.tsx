import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findClientByPortalToken, linkPortalAccount } from "@/lib/portal-claim";
import { ClaimForm } from "./claim-form";
import { ClientDoor, DoorNote } from "../../door";

export const metadata = { title: "Open my cleans", robots: { index: false, follow: false } };

/**
 * The portal invite landing.
 *
 * Signed out: one button, which signs the client in (no password; see
 * ./claim-form.tsx). Signed in: if the session's email is the invite's, link
 * it and go. Signed in as someone else: say so, offer sign out.
 */
export default async function ClaimPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const sessionEmail = ((claims?.claims?.email as string | undefined) ?? "").toLowerCase();

  if (userId) {
    const admin = createSupabaseAdminClient();
    const found = await findClientByPortalToken(admin, token);
    if (!found.ok) {
      return (
        <Shell>
          <Notice>{found.error}</Notice>
        </Shell>
      );
    }
    if (sessionEmail && sessionEmail === found.client.email.toLowerCase()) {
      const linked = await linkPortalAccount(admin, found.client, userId);
      if (!linked.ok) {
        return (
          <Shell>
            <Notice>{linked.error}</Notice>
          </Shell>
        );
      }
      redirect("/client");
    }
    return (
      <Shell>
        <Notice>
          This invite was sent to <strong>{found.client.email}</strong>, but you&rsquo;re
          signed in as <strong>{sessionEmail || "a different account"}</strong>. Sign out,
          then open the link again.
        </Notice>
        {/* A form, never a link — /auth/logout is POST-only. */}
        <form method="POST" action="/auth/logout" className="mt-3">
          <input type="hidden" name="next" value={`/client/claim/${token}`} />
          <button
            type="submit"
            className="flex h-10 w-full items-center justify-center rounded-md border border-border text-sm font-semibold transition-all hover:bg-muted active:scale-[0.98] active:bg-muted"
          >
            Sign out
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <ClaimForm token={token} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ClientDoor title="Your cleaner invited you" lede="Press the button to see your visits and invoices. There is no password to set up.">
      {children}
    </ClientDoor>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <DoorNote>{children}</DoorNote>;
}
