"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { preparePeriodAction } from "./actions";

/** One-click "settle this old window": prepares the period (strictly its
 *  own dates) and lands on its page. */
export function PreparePeriodButton({
  start,
  end,
}: {
  start: string;
  end: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setError(false);
        const fd = new FormData();
        fd.set("period_start", start);
        fd.set("period_end", end);
        startTransition(async () => {
          const r = await preparePeriodAction(fd);
          if (r.ok) {
            router.push(r.href);
          } else {
            setError(true);
            toast.error(r.error);
          }
        });
      }}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-opacity ${
        error
          ? "border border-destructive text-destructive"
          : "bg-foreground text-background hover:opacity-90"
      } disabled:opacity-50`}
    >
      {pending ? "Preparing…" : "Prepare"}
    </button>
  );
}
