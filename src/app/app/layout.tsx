import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { LogOut } from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Phase 1: any active membership can reach /app. Role-gating to admin/owner
  // happens at the page level for now; in Phase 3 we'll move it into the
  // sidebar layout once /field exists.
  const membership = await requireMembership();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">CleanOps</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              {membership.organization_name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">
              {membership.role}
            </span>
            <Link
              href="/auth/logout"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
