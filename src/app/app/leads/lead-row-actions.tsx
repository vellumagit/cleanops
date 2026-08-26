"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { LEAD_STAGES, type LeadStage } from "@/lib/lead-pipeline";
import {
  setLeadStageAction,
  convertLeadAction,
  markLeadLostAction,
  reopenLeadAction,
} from "./actions";

/**
 * Per-lead controls: where they are, and the two ways out.
 *
 * Stage buttons are plain submits rather than a dropdown — one tap to move
 * someone from New to Contacted, which is the action she'll take most often and
 * usually right after hanging up.
 */
export function LeadRowActions({
  id,
  stage,
  lost,
}: {
  id: string;
  stage: LeadStage;
  lost: boolean;
}) {
  if (lost) {
    return (
      <form action={reopenLeadAction} className="shrink-0">
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
        >
          <RotateCcw className="h-3 w-3" />
          Reopen
        </button>
      </form>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
        {LEAD_STAGES.map((s) => (
          <form key={s.key} action={setLeadStageAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="stage" value={s.key} />
            <button
              type="submit"
              disabled={s.key === stage}
              title={s.hint}
              className={[
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                s.key === stage
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {s.label}
            </button>
          </form>
        ))}
      </div>

      <a
        href={`/app/clients/${id}/edit`}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
      >
        Edit
      </a>
      <form action={convertLeadAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          title="They said yes — make them a client"
          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
        >
          <Check className="h-3 w-3" />
          Won
        </button>
      </form>

      <form action={markLeadLostAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          title="They went elsewhere — kept, not deleted"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Lost
        </button>
      </form>
    </div>
  );
}
