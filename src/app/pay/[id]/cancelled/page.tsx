import Link from "next/link";
import { XCircle } from "lucide-react";

export const metadata = { title: "Payment cancelled" };

export default function PaymentCancelledPage() {
  return (
    <main className="sollos-wash relative min-h-screen">
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <div className="w-full rounded-xl border border-border bg-card p-8 text-center shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <XCircle className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Payment cancelled
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No charge was made. If this was a mistake, go back to the
            invoice email and click the link again.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Close
          </Link>
        </div>
      </div>
    </main>
  );
}
