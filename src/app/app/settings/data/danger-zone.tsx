"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import {
  scheduleOrgDeletionAction,
  cancelOrgDeletionAction,
  type ScheduleDeletionState,
} from "./actions";

export function DeletionDangerZone({ orgName }: { orgName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction] = useActionState<
    ScheduleDeletionState,
    FormData
  >(scheduleOrgDeletionAction, {});

  if (state.ok) {
    return (
      <section className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="text-sm font-semibold text-amber-700">
          Deletion scheduled.
        </p>
        <p className="mt-1 text-xs text-amber-700/80">
          Reload the page to see the countdown banner and the cancel button.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-red-500/40 bg-red-500/5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
          <p className="mt-1 text-xs text-red-700/80">
            Schedule permanent deletion of{" "}
            <strong className="text-red-700">{orgName}</strong>. A 30-day grace
            window is enforced — you can cancel anytime within that window and
            nothing is lost. After 30 days, every row and file associated with
            your organization is permanently wiped. This cannot be undone.
          </p>

          {!expanded ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700"
              onClick={() => setExpanded(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete organization
            </Button>
          ) : (
            <form action={formAction} className="mt-4 space-y-3">
              <div>
                <Label htmlFor="confirm_name" className="text-xs text-red-700">
                  Type <strong>{orgName}</strong> to confirm
                </Label>
                <Input
                  id="confirm_name"
                  name="confirm_name"
                  required
                  autoComplete="off"
                  placeholder={orgName}
                  className="mt-1 max-w-md"
                />
                <input
                  type="hidden"
                  name="expected_name"
                  value={orgName}
                />
              </div>

              {state.error && (
                <p className="text-xs text-red-700">{state.error}</p>
              )}

              <div className="flex items-center gap-2">
                <SubmitButton
                  variant="destructive"
                  size="sm"
                  pendingLabel="Scheduling…"
                >
                  Schedule deletion
                </SubmitButton>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

export function CancelDeletionButton() {
  return (
    <form action={cancelOrgDeletionAction}>
      <SubmitButton
        variant="outline"
        size="sm"
        pendingLabel="Cancelling…"
        className="border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700"
      >
        Cancel scheduled deletion
      </SubmitButton>
    </form>
  );
}
