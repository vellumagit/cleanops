"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { FileText, Upload, Trash2, ExternalLink } from "lucide-react";
import {
  createEstimateAction,
  updateEstimateAction,
  type EstimateFormState,
} from "./actions";
import { EstimateLinesFields, type ExistingEstimateLine } from "./estimate-lines-fields";

const empty: EstimateFormState = {};

type Defaults = {
  client_id?: string;
  service_description?: string | null;
  notes?: string | null;
  status?: string;
  total_dollars?: string;
  /** The top of a price range, when the estimate has one. */
  total_high_dollars?: string;
  pdf_url?: string | null;
  lines?: ExistingEstimateLine[];
};

export function EstimateForm({
  mode,
  id,
  defaults,
  clients,
  currency = "CAD",
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  clients: { id: string; label: string }[];
  currency?: "CAD" | "USD";
}) {
  const action =
    mode === "create"
      ? createEstimateAction
      : updateEstimateAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

  // "Someone new" is offered on a new estimate only; a saved estimate
  // already belongs to someone.
  const [who, setWho] = useState<"existing" | "new">(
    mode === "create" && (v as Record<string, string | undefined>).who === "new" ? "new" : "existing",
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [removeFlag, setRemoveFlag] = useState(false);
  const existingPdf = defaults?.pdf_url ?? null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setRemoveFlag(false);
  }

  function handleRemovePdf() {
    setPdfFileName(null);
    setRemoveFlag(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      {/* Who it is for. A new estimate can be for someone who isn't on the
          books yet: they are added as a lead when the estimate is saved. */}
      {mode === "create" && (
        <div className="space-y-2">
          <input type="hidden" name="who" value={who} />
          <div role="group" aria-label="Who is this estimate for?" className="inline-flex rounded-md border border-border p-0.5 text-xs font-medium">
            {(
              [
                ["existing", "Someone on your books"],
                ["new", "Someone new"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={who === key}
                onClick={() => setWho(key)}
                className={
                  who === key
                    ? "rounded bg-foreground px-3 py-1.5 text-background"
                    : "rounded px-3 py-1.5 text-muted-foreground hover:text-foreground"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {who === "new" ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <FormField label="Their name" htmlFor="new_name" required error={state.errors?.client_id}>
            <Input id="new_name" name="new_name" required maxLength={200} placeholder="e.g. Dana Whitfield" defaultValue={v.new_name ?? ""} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Email" htmlFor="new_email" hint="Needed to send them the estimate.">
              <Input id="new_email" name="new_email" type="email" inputMode="email" placeholder="name@example.com" defaultValue={v.new_email ?? ""} />
            </FormField>
            <FormField label="Phone" htmlFor="new_phone">
              <Input id="new_phone" name="new_phone" type="tel" inputMode="tel" placeholder="(555) 123-4567" defaultValue={v.new_phone ?? ""} />
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">
            They are added to your Leads, not your clients, and move to clients when you book them. If the email
            matches someone already on your books, the estimate goes on that person&rsquo;s record.
          </p>
        </div>
      ) : (
        <FormField
          label={mode === "create" ? "Client or lead" : "Client"}
          htmlFor="client_id"
          required
          error={state.errors?.client_id}
        >
          <FormSelect
            id="client_id"
            name="client_id"
            required
            defaultValue={v.client_id ?? defaults?.client_id ?? ""}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      )}

      <FormField
        label="Summary"
        htmlFor="service_description"
        error={state.errors?.service_description}
        hint="Optional. A sentence or two above the line items: what the job is, or anything the lines don't say."
      >
        <Textarea
          id="service_description"
          name="service_description"
          rows={3}
          defaultValue={
            v.service_description ?? defaults?.service_description ?? ""
          }
        />
      </FormField>

      <div className="rounded-lg border border-border p-4">
        <EstimateLinesFields
          existing={defaults?.lines ?? []}
          totalDollars={v.total_cents ?? defaults?.total_dollars ?? ""}
          currency={currency}
          error={state.errors?.total_cents}
          allowRange
          totalHighDollars={defaults?.total_high_dollars ?? ""}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Status"
          htmlFor="status"
          required
          error={state.errors?.status}
          hint="Changes to Sent when you email it, and to Approved or Declined when the client answers from their link."
        >
          <FormSelect
            id="status"
            name="status"
            defaultValue={v.status ?? defaults?.status ?? "draft"}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            {/* The expiry cron writes this status. Without the option, an
                expired estimate opened here showed as Draft, and saving it
                quietly made it one. */}
            <option value="expired">Expired</option>
          </FormSelect>
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={v.notes ?? defaults?.notes ?? ""}
        />
      </FormField>

      {/* PDF upload */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" />
          PDF attachment
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Upload a PDF estimate, quote, or proposal. Max 10 MB.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Existing PDF link */}
          {existingPdf && !removeFlag && !pdfFileName && (
            <a
              href={existingPdf}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <FileText className="h-3.5 w-3.5 text-red-500" />
              View attached PDF
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          )}

          {/* New file name preview */}
          {pdfFileName && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium">
              <FileText className="h-3.5 w-3.5 text-red-500" />
              {pdfFileName}
            </span>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {existingPdf && !removeFlag ? "Replace" : "Upload PDF"}
          </Button>

          {(existingPdf || pdfFileName) && !removeFlag && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemovePdf}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            name="pdf"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            type="hidden"
            name="remove_pdf"
            value={removeFlag ? "1" : "0"}
          />
        </div>

        {state.errors?.pdf && (
          <p className="mt-2 text-xs text-destructive">{state.errors.pdf}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/estimates"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create estimate" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
