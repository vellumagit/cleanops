"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { putLeftOffCrewOnAction } from "./actions";

/**
 * "Put them on anyway", beside a note that someone was left off a visit
 * (or several, after a series save) because they had another job then.
 * One press puts them on those visits, double-booked, so the office can
 * move each visit itself. Shown to owners, admins and managers, and only where
 * someone was left off for another job; the action checks both again.
 */
export function PutOnAnywayButton({
  bookingIds,
  seriesId,
  label = "Put them on anyway",
  onDone,
}: {
  bookingIds?: string[];
  seriesId?: string;
  label?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      data-testid="put-on-anyway"
      onClick={() =>
        startTransition(async () => {
          const res = await putLeftOffCrewOnAction({ bookingIds, seriesId });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(
            `Put on ${res.visits} visit${res.visits === 1 ? "" : "s"}, double-booked. Move ${
              res.visits === 1 ? "it" : "them"
            } when you're ready.`,
          );
          onDone?.();
          router.refresh();
        })
      }
    >
      {pending ? "Putting them on…" : label}
    </Button>
  );
}
