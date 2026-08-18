"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { LEAD_SOURCES, DEFAULT_LEAD_SOURCE } from "@/lib/lead-pipeline";
import { addLeadAction, type LeadFormState } from "./actions";

const empty: LeadFormState = {};

/**
 * Add a lead in ten seconds.
 *
 * Deliberately one row of inputs with ONE required field. Phone and email
 * inquiries can't be captured by software, so this is the only way most leads
 * will ever arrive — and if it's slower than writing a name on paper, paper
 * wins and the list stays empty. Everything past the name is optional and the
 * form resets itself so a second lead can go straight in.
 */
export function QuickAddLead() {
  const [state, formAction] = useActionState(addLeadAction, empty);
  const [expanded, setExpanded] = useState(false);

  // Clear after a save so the next lead can go straight in. Done by REMOUNTING
  // the form via its key rather than calling formRef.current.reset() — reading
  // a ref during render is genuinely wrong and eslint is right to refuse it.
  //
  // Keyed on the new lead's id, not the success message: two leads called
  // "Dana" in a row produce the same message, and the second form would keep
  // her details sitting in it looking unsaved.
  const formKey = state.addedId ?? "new";

  return (
    <form
      key={formKey}
      action={formAction}
      className="rounded-lg border border-border bg-card p-4"
    >
      <FormError message={state.error} />

      {state.success && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          {state.success}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="lead-name" className="text-[11px] font-medium">
            Name
          </label>
          <input
            id="lead-name"
            name="name"
            required
            autoComplete="off"
            placeholder="Who called?"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="min-w-[130px] flex-1">
          <label htmlFor="lead-phone" className="text-[11px] font-medium">
            Phone <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="min-w-[100px]">
          <label htmlFor="lead-source" className="text-[11px] font-medium">
            Came from
          </label>
          <select
            id="lead-source"
            name="source"
            defaultValue={DEFAULT_LEAD_SOURCE}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            {LEAD_SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <SubmitButton>
          <Plus className="h-4 w-4" />
          Add
        </SubmitButton>
      </div>

      {/* The rest, behind one click. Keeping email and the note out of the
          default view is what keeps the common case to a single line. */}
      {expanded ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="lead-email" className="text-[11px] font-medium">
              Email
            </label>
            <input
              id="lead-email"
              name="email"
              type="email"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label htmlFor="lead-note" className="text-[11px] font-medium">
              What do they want?
            </label>
            <input
              id="lead-note"
              name="note"
              autoComplete="off"
              placeholder="3 bed, biweekly, asked about Thursdays"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          + email and what they want
        </button>
      )}
    </form>
  );
}
