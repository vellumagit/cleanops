"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormField, FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  sendAnnouncementAction,
  type AnnounceState,
} from "@/lib/announce-actions";

const empty: AnnounceState = {};

export function AnnounceForm({
  teamSize,
  pushDevices,
}: {
  teamSize: number;
  pushDevices: number;
}) {
  const [state, action] = useActionState(sendAnnouncementAction, empty);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.sent) {
      toast.success(
        state.sent.email
          ? `Announced to the team — and emailed ${state.sent.emailed} ${
              state.sent.emailed === 1 ? "person" : "people"
            }.`
          : "Announced to the team.",
      );
    }
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      {/* Remounting on success is what clears the fields AND the email
          checkbox. Resetting them from the effect would mean calling
          setState inside it, which React (rightly) flags. */}
      <Fields
        key={state.sent?.sentAt ?? 0}
        state={state}
        teamSize={teamSize}
        pushDevices={pushDevices}
      />
    </form>
  );
}

function Fields({
  state,
  teamSize,
  pushDevices,
}: {
  state: AnnounceState;
  teamSize: number;
  pushDevices: number;
}) {
  const [email, setEmail] = useState(state.values?.email ?? false);

  return (
    <div className="space-y-5">
      <FormField label="Subject" htmlFor="title" required>
        <input
          id="title"
          name="title"
          maxLength={120}
          defaultValue={state.values?.title ?? ""}
          placeholder="Schedule change for next week"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </FormField>

      <FormField
        label="Message"
        htmlFor="body"
        required
        hint="Posted to #general, and saved to everyone's notifications."
      >
        <textarea
          id="body"
          name="body"
          rows={7}
          maxLength={5000}
          defaultValue={state.values?.body ?? ""}
          placeholder="Write it the way you'd say it in the group chat."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </FormField>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          name="email"
          checked={email}
          onChange={(e) => setEmail(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">Also email it to everyone</span>
          <span className="text-xs text-muted-foreground">
            {email
              ? `Goes to all ${teamSize} active team members.`
              : `Off by default. Only ${pushDevices} ${
                  pushDevices === 1 ? "device has" : "devices have"
                } push turned on, so for anything people must actually see, tick this.`}
          </span>
        </span>
      </label>

      <SubmitButton pendingLabel="Sending…">
        {email ? "Announce and email" : "Announce"}
      </SubmitButton>
    </div>
  );
}
