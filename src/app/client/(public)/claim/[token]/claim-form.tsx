"use client";

import { useActionState } from "react";
import { openPortalInviteAction } from "@/app/app/clients/portal-actions";
import { DoorButton } from "../../door";

/**
 * The invite page's one button. No password to choose: pressing it signs the
 * client in (portal-actions openPortalInviteAction).
 */
export function ClaimForm({ token }: { token: string }) {
  const [state, open, pending] = useActionState(openPortalInviteAction, {});
  return (
    <form action={open} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
          {state.error}
        </div>
      )}
      <DoorButton disabled={pending}>{pending ? "Opening…" : "Open my cleans"}</DoorButton>
    </form>
  );
}
