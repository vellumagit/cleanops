import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export const metadata = { title: "Payment received" };

export default function PaymentSuccessPage() {
  return (
    <main className="sollos-wash relative min-h-screen">
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <div className="w-full rounded-xl border border-border bg-card p-8 text-center shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Payment received
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thank you — your payment was successful. You&rsquo;ll receive a
            receipt by email shortly.
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
