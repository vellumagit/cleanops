import { Skeleton } from "@/components/skeleton";

/**
 * The public invoice a client lands on from "Pay now" — the highest-intent tap
 * in the portal. It is a top-level segment, so with no boundary here it falls
 * to src/app/loading.tsx, the full-screen splash, after a rate-limit check and
 * several sequential queries.
 */
export default function PublicInvoiceLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-10 w-40" />
        <div className="mt-5 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
    </div>
  );
}
