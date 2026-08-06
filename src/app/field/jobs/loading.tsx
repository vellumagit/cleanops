import { Skeleton, SkeletonList } from "@/components/skeleton";

export default function FieldJobsLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-28" />
      <SkeletonList count={3} />
    </div>
  );
}
