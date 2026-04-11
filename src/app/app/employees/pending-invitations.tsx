"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Copy, Check, X, Clock } from "lucide-react";
import { revokeInvitationAction } from "./actions";
import { formatDate, humanizeEnum } from "@/lib/format";

export type InvitationRow = {
  id: string;
  email: string;
  role: "owner" | "admin" | "employee";
  token: string;
  created_at: string;
  expires_at: string;
  expired: boolean;
};

function InvitationCard({
  inv,
  siteUrl,
}: {
  inv: InvitationRow;
  siteUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const inviteLink = `${siteUrl}/join/${inv.token}`;

  function handleCopy() {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{inv.email}</span>
          <StatusBadge tone={inv.role === "admin" ? "blue" : "neutral"}>
            {humanizeEnum(inv.role)}
          </StatusBadge>
          {inv.expired ? (
            <StatusBadge tone="red">Expired</StatusBadge>
          ) : (
            <StatusBadge tone="amber">Pending</StatusBadge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          <Clock className="mr-1 inline h-3 w-3" />
          Invited {formatDate(inv.created_at)}
          {!inv.expired && (
            <> &middot; Expires {formatDate(inv.expires_at)}</>
          )}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!inv.expired && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            title="Copy invite link"
            className="h-8 w-8"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        )}
        <form action={revokeInvitationAction}>
          <input type="hidden" name="id" value={inv.id} />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            title="Revoke invitation"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

export function PendingInvitations({
  invitations,
  siteUrl,
}: {
  invitations: InvitationRow[];
  siteUrl: string;
}) {
  if (invitations.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-foreground">
        Pending invitations ({invitations.length})
      </h2>
      <div className="space-y-2">
        {invitations.map((inv) => (
          <InvitationCard key={inv.id} inv={inv} siteUrl={siteUrl} />
        ))}
      </div>
    </div>
  );
}
