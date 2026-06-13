"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { resolveShiftRequestAction } from "./actions";

export function ResolveRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await resolveShiftRequestAction(requestId);
          if (res.ok) {
            toast.success("Marked handled");
            router.refresh();
          } else {
            toast.error(res.error);
          }
        })
      }
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-card px-2.5 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/30"
    >
      <Check className="h-3.5 w-3.5" />
      {isPending ? "…" : "Mark handled"}
    </button>
  );
}
