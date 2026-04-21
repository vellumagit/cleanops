import Link from "next/link";
import { Archive, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

type Props = {
  /** Current list base path without trailing slash, e.g. "/app/bookings" */
  basePath: string;
  /** Whether the current view is the archive view */
  showingArchived: boolean;
  /** Preserve these query params when toggling (optional) */
  extraParams?: Record<string, string | undefined>;
};

/**
 * Small toggle link shown above list views that have an archived-records
 * filter. Switches between "active" (archived_at is null) and "archived"
 * (archived_at is not null) via a ?archived=1 query param.
 */
export function ArchivedToggle({
  basePath,
  showingArchived,
  extraParams,
}: Props) {
  const params = new URLSearchParams();
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) params.set(k, v);
    }
  }
  if (!showingArchived) params.set("archived", "1");

  const qs = params.toString();
  const href = qs ? `${basePath}?${qs}` : basePath;

  return (
    <Link
      href={href}
      className={
        buttonVariants({ variant: "outline", size: "sm" }) +
        (showingArchived ? " text-foreground" : " text-muted-foreground")
      }
    >
      {showingArchived ? (
        <>
          <ArrowLeft className="h-4 w-4" />
          Back to active
        </>
      ) : (
        <>
          <Archive className="h-4 w-4" />
          Show archived
        </>
      )}
    </Link>
  );
}
