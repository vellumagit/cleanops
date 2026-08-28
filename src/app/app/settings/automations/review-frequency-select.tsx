"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  REVIEW_ASK_FREQUENCY_OPTIONS,
  type ReviewAskFrequency,
} from "@/lib/review-cadence";
import { setReviewAskFrequencyAction } from "./actions";

/**
 * The ask cadence, living beside the toggle it configures. Auto-saves on
 * change — a dropdown with a separate Save button is one click of ceremony
 * more than a cadence deserves.
 */
export function ReviewFrequencySelect({
  current,
}: {
  current: ReviewAskFrequency;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="mr-2 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      Ask at most
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("frequency", e.target.value);
          startTransition(async () => {
            await setReviewAskFrequencyAction(fd);
            router.refresh();
          });
        }}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
      >
        {REVIEW_ASK_FREQUENCY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
