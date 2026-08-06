import { Skeleton, SkeletonList } from "@/components/skeleton";

export default function FieldHoursLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-9 w-full rounded-lg" />
      <SkeletonList count={4} lines={1} />
    </div>
  );
}
