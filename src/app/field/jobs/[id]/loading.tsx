import { Skeleton } from "@/components/skeleton";

/**
 * The job a cleaner taps into from their list. It runs several queries —
 * booking, crew, photos, checklist — so on a phone this was a blank pause
 * exactly when someone is standing at a door waiting to start.
 */
export default function FieldJobLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-20" />
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <div className="mt-5 space-y-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/5" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
