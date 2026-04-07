import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Phase 0 · Foundation deployed
        </div>

        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          CleanOps
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
          Operations software for cleaning companies. Bookings, scheduling,
          employees, invoicing, training and field tools — in one place.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Sign in
          </Link>
          <Link
            href="/signup"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            Get started
          </Link>
        </div>

        <p className="mt-12 text-xs text-muted-foreground">
          Built on Next.js, Supabase and Vercel. Multi-tenant, RLS-enforced,
          audit-logged.
        </p>
      </div>
    </main>
  );
}
