import { Skeleton, SkeletonList } from "@/components/skeleton";

export default function ClientJobsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-32" />
      <SkeletonList count={4} />
    </div>
  );
}
