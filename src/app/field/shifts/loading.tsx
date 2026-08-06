import { Skeleton, SkeletonList } from "@/components/skeleton";

export default function FieldShiftsLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-32" />
      <SkeletonList count={3} />
    </div>
  );
}
