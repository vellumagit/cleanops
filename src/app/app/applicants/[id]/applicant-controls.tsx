"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  setApplicantStatusAction,
  saveApplicantNotesAction,
} from "../actions";

const PIPELINE = [
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "interview", label: "Interview" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
] as const;

export function ApplicantControls({
  id,
  status,
  notes,
}: {
  id: string;
  status: string;
  notes: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [noteText, setNoteText] = useState(notes ?? "");
  const [savingNotes, startSavingNotes] = useTransition();

  function setStatus(next: string) {
    if (next === status) return;
    startTransition(async () => {
      const res = await setApplicantStatusAction(id, next);
      if (res.ok) {
        toast.success(`Moved to ${next}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function saveNotes() {
    startSavingNotes(async () => {
      const res = await saveApplicantNotesAction(id, noteText);
      if (res.ok) toast.success("Notes saved");
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold">Stage</h2>
        <div className="flex flex-wrap gap-2">
          {PIPELINE.map((p) => {
            const active = p.key === status;
            return (
              <button
                key={p.key}
                type="button"
                disabled={isPending}
                onClick={() => setStatus(p.key)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Internal notes</h2>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={4}
          placeholder="Notes about this applicant (only your team sees these)…"
          className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={saveNotes}
            disabled={savingNotes || noteText === (notes ?? "")}
          >
            {savingNotes ? "Saving…" : "Save notes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
