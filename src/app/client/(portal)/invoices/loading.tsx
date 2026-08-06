import { Skeleton, SkeletonList } from "@/components/skeleton";

export default function ClientInvoicesLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-36" />
      <SkeletonList count={3} lines={1} />
    </div>
  );
}
