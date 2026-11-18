"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markBonusPaidAction } from "@/app/app/bonuses/actions";

/**
 * "Mark paid" for one pending bonus, right where the owner is told it is
 * still owed. Before this the warning said "resolve on Bonuses" and left
 * them to go and find it; Brian looked for it under Payroll.
 */
export function SettleBonusButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await markBonusPaidAction(id);
          if (res.ok) {
            toast.success("Bonus marked paid");
            // The "still owed" figure above is worked out on the server.
            router.refresh();
          } else {
            toast.error(res.error);
          }
        })
      }
    >
      {pending ? "Saving…" : "Mark paid"}
    </Button>
  );
}
