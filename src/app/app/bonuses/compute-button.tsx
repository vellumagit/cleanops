"use client";

import { useTransition } from "react";
import { Calculator } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { computeBonusesAction } from "./actions";

export function ComputeBonusesButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="default"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await computeBonusesAction();
          if (res.ok) {
            const created = res.created;
            const skipped = res.skipped;
            toast.success(
              created === 0
                ? `No new bonuses (${skipped} employee${skipped === 1 ? "" : "s"} skipped)`
                : `Created ${created} bonus${created === 1 ? "" : "es"}`,
            );
          } else {
            toast.error(res.error);
          }
        })
      }
    >
      <Calculator className="h-4 w-4" />
      {pending ? "Computing…" : "Compute bonuses"}
    </Button>
  );
}
