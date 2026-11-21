import { Skeleton, SkeletonList } from "@/components/skeleton";

// In-shell wait. Without it this tab fell through to /field/loading.tsx, the
// full-screen boot splash (see src/app/field/clock/loading.tsx).
export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-28" />
      <SkeletonList count={3} />
    </div>
  );
}
