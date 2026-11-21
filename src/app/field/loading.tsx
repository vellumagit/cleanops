import { BootSplashOr } from "@/components/boot-splash";
import { Skeleton, SkeletonList } from "@/components/skeleton";

/**
 * Field-app boot splash. Also fires when a cleaner signs in for the
 * first time on a new device and /field is streaming. After that, inside
 * the app, an in-shell skeleton instead (src/components/boot-splash.tsx).
 */
export default function FieldLoading() {
  return (
    <BootSplashOr tagline="Loading your crew">
      <div className="space-y-5">
        <Skeleton className="h-7 w-28" />
        <SkeletonList count={3} />
      </div>
    </BootSplashOr>
  );
}
