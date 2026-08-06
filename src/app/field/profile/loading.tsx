import { Skeleton, SkeletonList } from "@/components/skeleton";

/**
 * In-shell wait. Without this the route falls through to src/app/field/loading.tsx,
 * which is the full-screen SollosLoader — a boot splash that blanks the phone,
 * covers the header and the tab bar the thumb just touched, then swaps back.
 * That reads as a cold start on what is usually a sub-second navigation.
 */
export default function FieldProfileLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-32" />
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-5 w-1/2" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <SkeletonList count={2} lines={1} />
    </div>
  );
}
