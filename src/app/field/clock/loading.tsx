import { Skeleton, SkeletonList } from "@/components/skeleton";

/**
 * In-shell wait. Without this the route falls through to src/app/field/loading.tsx,
 * which is the full-screen SollosLoader — a boot splash that blanks the phone,
 * covers the header and the tab bar the thumb just touched, then swaps back.
 * That reads as a cold start on what is usually a sub-second navigation.
 */
export default function FieldClockLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-28" />
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-6 w-2/5" />
        <Skeleton className="mt-3 h-12 w-full rounded-lg" />
      </div>
      <SkeletonList count={3} lines={1} />
    </div>
  );
}
