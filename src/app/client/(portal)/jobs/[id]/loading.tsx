import { Skeleton } from "@/components/skeleton";

export default function ClientJobLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-24" />
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-6 w-2/5" />
        <div className="mt-4 space-y-3.5">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
