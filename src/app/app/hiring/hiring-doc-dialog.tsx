"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/submit-button";
import { saveHiringDocAction, type HiringDocFormState } from "./actions";

const empty: HiringDocFormState = {};

const COPY = {
  questionnaire: {
    createLabel: "New questionnaire",
    titlePlaceholder: "e.g. First phone interview",
    itemsLabel: "Questions — one per line",
    itemsPlaceholder:
      "Tell me about your last cleaning job.\nHow do you get to work sites?\nWhat days can you work?",
    description:
      "The questions you work through when interviewing an applicant.",
  },
  procedure: {
    createLabel: "New procedure",
    titlePlaceholder: "e.g. From yes to first shift",
    itemsLabel: "Steps — one per line",
    itemsPlaceholder:
      "Collect SIN + banking info\nSign the contract\nAdd to Employees and set pay rate\nAssign the onboarding training",
    description:
      "The steps your hiring process follows, so nothing depends on memory.",
  },
} as const;

export function HiringDocDialog({
  kind,
  doc,
}: {
  kind: "questionnaire" | "procedure";
  doc?: {
    id: string;
    title: string;
    items: string[];
    notes: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveHiringDocAction, empty);
  const c = COPY[kind];

  useEffect(() => {
    if (state.savedAt) setOpen(false);
  }, [state.savedAt]);

  return (
    <>
      {doc ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          {c.createLabel}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {doc ? `Edit ${kind}` : c.createLabel}
            </DialogTitle>
            <DialogDescription>{c.description}</DialogDescription>
          </DialogHeader>
          <form action={action} className="mt-1 space-y-4">
            {doc && <input type="hidden" name="id" value={doc.id} />}
            <input type="hidden" name="kind" value={kind} />
            {state.error && (
              <p className="text-xs font-medium text-destructive">
                {state.error}
              </p>
            )}
            <div className="space-y-1.5">
              <label htmlFor={`hd-title-${doc?.id ?? kind}`} className="text-xs font-medium">
                Title
              </label>
              <input
                id={`hd-title-${doc?.id ?? kind}`}
                name="title"
                required
                maxLength={160}
                defaultValue={doc?.title ?? ""}
                placeholder={c.titlePlaceholder}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`hd-items-${doc?.id ?? kind}`} className="text-xs font-medium">
                {c.itemsLabel}
              </label>
              <textarea
                id={`hd-items-${doc?.id ?? kind}`}
                name="items"
                rows={8}
                defaultValue={(doc?.items ?? []).join("\n")}
                placeholder={c.itemsPlaceholder}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`hd-notes-${doc?.id ?? kind}`} className="text-xs font-medium">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id={`hd-notes-${doc?.id ?? kind}`}
                name="notes"
                rows={2}
                defaultValue={doc?.notes ?? ""}
                placeholder="Anything the interviewer or hirer should know up front."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
