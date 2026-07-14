"use client";

import { useTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { invitePortalAction } from "../portal-actions";

type Props = {
  clientId: string;
  clientEmail: string | null;
  /** True once the client has accepted the invite (profile_id is set). */
  hasPortalAccess: boolean;
  /** Set when an invite has been sent but not yet accepted. */
  portalInvitedAt: string | null;
  portalInviteExpiresAt: string | null;
};

/**
 * Compact portal-invite control for the client detail page actions bar.
 * Shows the right state at a glance and lets owners send / resend without
 * navigating to the edit page.
 */
export function PortalInviteButton({
  clientId,
  clientEmail,
  hasPortalAccess,
  portalInvitedAt,
  portalInviteExpiresAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Resolve "now" after mount so the expiry comparison doesn't call Date.now()
  // during render (impure → server/client hydration drift). Until mounted we
  // treat the invite as not-expired, matching the server render.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: resolve the client clock after mount to avoid hydration drift
    setNowMs(Date.now());
  }, []);

  // Already claimed — show a static badge, no action needed.
  if (hasPortalAccess) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Portal active
      </span>
    );
  }

  function invite() {
    if (!clientEmail) {
      toast.error("Add an email to this client first.");
      return;
    }
    const fd = new FormData();
    fd.set("client_id", clientId);
    startTransition(async () => {
      const res = await invitePortalAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Portal invite sent");
      router.refresh();
    });
  }

  // Pending invite — show amber state + resend button.
  if (portalInvitedAt) {
    const expired = Boolean(
      portalInviteExpiresAt &&
        nowMs !== null &&
        new Date(portalInviteExpiresAt).getTime() < nowMs,
    );
    return (
      <button
        type="button"
        onClick={invite}
        disabled={pending}
        title={
          expired
            ? "Invite expired — click to resend"
            : `Invite sent ${new Date(portalInvitedAt).toLocaleDateString()} — click to resend`
        }
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <Clock className="h-3.5 w-3.5 text-amber-500" />
        {pending ? "Sending…" : expired ? "Resend invite" : "Invite pending"}
      </button>
    );
  }

  // No invite yet.
  return (
    <button
      type="button"
      onClick={invite}
      disabled={pending || !clientEmail}
      title={clientEmail ? "Send portal invite" : "Add an email first"}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      <Mail className="h-3.5 w-3.5" />
      {pending ? "Sending…" : "Invite to portal"}
    </button>
  );
}
