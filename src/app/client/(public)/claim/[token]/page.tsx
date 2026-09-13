import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findClientByPortalToken, linkPortalAccount } from "@/lib/portal-claim";
import { ClaimForm } from "./claim-form";

export const metadata = { title: "Set up your account" };

/**
 * The portal invite landing.
 *
 * Signed out: pick a password (a NEW login; an address that already has one
 * is sent to sign in instead). Signed in: if the session's email is the
 * invite's, link it and go — this is the only way an existing login is ever
 * connected to a client row. Signed in as someone else: say so, offer sign out.
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
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-bold">Set up your account</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick a password to finish claiming your client portal access.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      {children}
    </div>
  );
}
