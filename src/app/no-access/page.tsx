import type { Metadata } from "next";
import { ShieldOff } from "lucide-react";

export const metadata: Metadata = { title: "No access" };

/**
 * Shown to a signed-in user who has no ACTIVE membership — their access was
 * removed/suspended, or an invite hasn't been accepted yet. requireMembership()
 * redirects here instead of bouncing to /login (which loops) or letting a
 * server action surface the generic error boundary.
 */
export default function NoAccessPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <ShieldOff className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="mt-6 text-xl font-semibold">No active access</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your account isn&apos;t part of an active workspace right now. This
        usually means your access was removed or paused by an administrator, or
        an invitation hasn&apos;t been accepted yet.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        If you think this is a mistake, contact your organization&apos;s owner
        or admin to have your access restored.
      </p>
      <form action="/auth/logout" method="post" className="mt-8">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
