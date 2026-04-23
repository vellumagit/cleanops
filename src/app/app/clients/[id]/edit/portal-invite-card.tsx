"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Mail, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invitePortalAction } from "../../portal-actions";

type Props = {
  clientId: string;
  clientEmail: string | null;
  hasPortalAccess: boolean;
  portalInvitedAt: string | null;
  portalAcceptedAt: string | null;
  portalInviteExpiresAt: string | null;
};

/**
 * Client-portal invite panel on the client edit page. Covers three
 * states:
 *   1. Already has access (accepted invite) — show badge, no action.
 *   2. Invited but not yet accepted — show when sent + when it expires,
 *      allow re-send.
 *   3. No invite yet — show the Send button.
 */
export function PortalInviteCard({
  clientId,
  clientEmail,
  hasPortalAccess,
  portalInvitedAt,
  portalAcceptedAt,
  portalInviteExpiresAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
      toast.success("Invite sent");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-3 flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Client portal</h2>
      </div>

      {hasPortalAccess ? (
        <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="font-medium text-emerald-900 dark:text-emerald-300">
              Has portal access
            </p>
            <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
              Accepted{" "}
              {portalAcceptedAt
                ? new Date(portalAcceptedAt).toLocaleDateString()
                : "—"}
              . They can log in at /client/login with {clientEmail ?? "their email"}.
            </p>
          </div>
        </div>
      ) : portalInvitedAt ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-300">
              Invite sent, not yet accepted
            </p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
              Sent{" "}
              {new Date(portalInvitedAt).toLocaleDateString()} to{" "}
              {clientEmail ?? "—"}
              {portalInviteExpiresAt && (
                <>
                  {" · "}expires{" "}
                  {new Date(portalInviteExpiresAt).toLocaleDateString()}
                </>
              )}
              .
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={invite}
              disabled={pending}
              className="mt-2"
            >
              <Mail className="h-3.5 w-3.5" />
              {pending ? "Sending…" : "Resend invite"}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            Let this client log in at /client/login to see their upcoming
            jobs, past service history, and outstanding invoices in one
            place.
          </p>
          <Button
            type="button"
            onClick={invite}
            disabled={pending || !clientEmail}
            size="sm"
          >
            <Mail className="h-4 w-4" />
            {pending
              ? "Sending…"
              : clientEmail
                ? "Invite to portal"
                : "Add email first"}
          </Button>
        </div>
      )}
    </div>
  );
}
