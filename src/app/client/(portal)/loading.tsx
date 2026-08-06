import { Skeleton, SkeletonList } from "@/components/skeleton";

/**
 * Shown while the portal home streams. Shaped like the real page — a greeting,
 * then upcoming jobs, then anything outstanding — so nothing jumps when the
 * data lands.
 */
export default function ClientHomeLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <SkeletonList count={2} />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <SkeletonList count={1} lines={1} />
      </div>
    </div>
  );
}
