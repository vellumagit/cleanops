import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentClient } from "@/lib/client-auth";
import { ClientLoginForm } from "./login-form";

export const metadata = { title: "Client sign-in" };

// Standalone page — render without the tab-bar layout.
export default async function ClientLoginPage() {
  const existing = await getCurrentClient();
  if (existing) redirect("/client");

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-bold">Client sign-in</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in with the email + password you set up when you claimed
            your account.
          </p>
        </div>
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
