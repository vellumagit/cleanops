"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/submit-button";
import { updateLeadAction, type LeadFormState } from "./actions";

const empty: LeadFormState = {};

/**
 * Edit a lead WHERE IT LIVES. Brian, third time hitting client pages from
 * the leads list: "it still goes to the fucking client profile... they're
 * not clients yet. I just need to quickly add a note." Right — a lead edit
 * is four fields and a note, and it happens in a dialog on the leads page.
 * Client-land starts when Make client is pressed, not before.
 */
export function LeadEditDialog({
  id,
  name,
  phone,
  email,
  address,
  note,
}: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateLeadAction, empty);

  // Close on successful save — keyed on the success marker changing.
  useEffect(() => {
    if (state.savedAt) setOpen(false);
  }, [state.savedAt]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
          </DialogHeader>
          <form action={action} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            {state.error && (
              <p className="text-xs font-medium text-destructive">
                {state.error}
              </p>
            )}
            <div>
              <label htmlFor={`lead-name-${id}`} className="text-[11px] font-medium">
                Name
              </label>
              <input
                id={`lead-name-${id}`}
                name="name"
                required
                defaultValue={name}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`lead-phone-${id}`} className="text-[11px] font-medium">
                  Phone
                </label>
                <input
                  id={`lead-phone-${id}`}
                  name="phone"
                  type="tel"
                  defaultValue={phone ?? ""}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor={`lead-email-${id}`} className="text-[11px] font-medium">
                  Email
                </label>
                <input
                  id={`lead-email-${id}`}
                  name="email"
                  type="email"
                  defaultValue={email ?? ""}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor={`lead-address-${id}`} className="text-[11px] font-medium">
                Address <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id={`lead-address-${id}`}
                name="address"
                defaultValue={address ?? ""}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor={`lead-note-${id}`} className="text-[11px] font-medium">
                What do they want?
              </label>
              <textarea
                id={`lead-note-${id}`}
                name="lead_note"
                rows={5}
                defaultValue={note ?? ""}
                placeholder="3 bed, biweekly, asked about Thursdays…"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
