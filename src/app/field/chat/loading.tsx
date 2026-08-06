import { Skeleton, SkeletonList } from "@/components/skeleton";

/**
 * In-shell wait. Without this the route falls through to src/app/field/loading.tsx,
 * which is the full-screen SollosLoader — a boot splash that blanks the phone,
 * covers the header and the tab bar the thumb just touched, then swaps back.
 * That reads as a cold start on what is usually a sub-second navigation.
 */
export default function FieldChatLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-40" />
      <SkeletonList count={4} lines={2} />
    </div>
  );
}
