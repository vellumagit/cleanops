"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { deletePayoutAction } from "../actions";

/** Small icon button that deletes a recorded payout after a confirm(). */
export function DeletePayoutButton({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!confirm("Delete this payment? This can't be undone.")) return;
    const fd = new FormData();
    fd.set("id", payoutId);
    startTransition(async () => {
      const res = await deletePayoutAction(fd);
      if (res.ok) {
        toast.success("Payment deleted");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={remove}
      className={cn(
        "rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
        "disabled:opacity-50",
      )}
      aria-label="Delete payment"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
