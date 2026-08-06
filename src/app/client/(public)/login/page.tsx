import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { ClientLoginForm } from "./login-form";

export const metadata = { title: "Client sign-in" };

// Standalone page — render without the tab-bar layout.
export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ claimed?: string }>;
}) {
  const existing = await getCurrentClient();
  if (existing) redirect("/client");

  const { claimed } = await searchParams;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-bold">Client sign-in</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in with the email + password you set up when you claimed your
            account.
          </p>
        </div>

        {/* Claiming can adopt an auth account that already existed, in which
            case the password typed on the claim page was deliberately never
            applied. Saying so here is the difference between signing in and
            trying a password that was never set. */}
        {claimed === "existing" && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Your account is linked. This email already had a login, so use the
            password you already have — the one you just typed was not applied.
            Or just have a sign-in link emailed to you below.
          </div>
        )}
        {claimed === "1" && (
          <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
            Account created. Sign in with the password you just chose.
          </div>
        )}
        <ClientLoginForm />
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Don&rsquo;t have an account?{" "}
          <Link
            href="/"
            className="text-primary underline-offset-2 hover:underline"
          >
            Ask the cleaning company for an invite
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
