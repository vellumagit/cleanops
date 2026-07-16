"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { requestSmsOptInAction } from "../actions";

type Props = {
  clientId: string;
  hasPhone: boolean;
  optedIn: boolean;
  requestedAt: string | null;
};

/**
 * Double opt-in control for the client detail page. Shows the client's SMS
 * consent state and lets an owner/admin send the "reply YES" request. Consent
 * is only granted when the client actually replies YES (inbound handler).
 */
export function SmsOptInButton({
  clientId,
  hasPhone,
  optedIn,
  requestedAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (optedIn) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Opted in to texts
      </span>
    );
  }

  function request() {
    if (!hasPhone) {
      toast.error("Add a phone number to this client first.");
      return;
    }
    const fd = new FormData();
    fd.set("client_id", clientId);
    startTransition(async () => {
      const res = await requestSmsOptInAction(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't send the opt-in request.");
        return;
      }
      toast.success("Opt-in request texted — they confirm by replying YES.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {requestedAt && (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <Clock className="h-3 w-3" />
          Opt-in requested — awaiting reply
        </span>
      )}
      <button
        type="button"
        onClick={request}
        disabled={pending || !hasPhone}
        title={
          hasPhone
            ? "Text this client a YES-to-confirm opt-in request"
            : "Add a phone number first"
        }
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {requestedAt ? "Resend SMS opt-in" : "Request SMS opt-in"}
      </button>
    </div>
  );
}
