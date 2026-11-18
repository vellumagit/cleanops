"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelScheduledRateAction } from "../actions";

/** Cancel a pay rate change that is scheduled and has not started yet. */
export function CancelScheduledRateButton({ changeId }: { changeId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className="font-medium underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      onClick={() => {
        if (!window.confirm("Cancel this scheduled rate change? The current rate stays as it is.")) return;
        startTransition(async () => {
          const res = await cancelScheduledRateAction(changeId);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Scheduled change cancelled");
          router.refresh();
        });
      }}
    >
      {pending ? "Cancelling…" : "Cancel"}
    </button>
  );
}
