"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const empty: EstimateFormState = {};

type Defaults = {
  client_id?: string;
  service_description?: string | null;
  notes?: string | null;
  status?: string;
  total_dollars?: string;
  pdf_url?: string | null;
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

      <FormField
        label="Client"
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

      <FormField
        label="Service description"
        htmlFor="service_description"
        error={state.errors?.service_description}
        hint="Short summary of what's being quoted"
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

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Status"
          htmlFor="status"
          required
          error={state.errors?.status}
          hint="Sent / decided dates auto-stamp on transition"
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
          </FormSelect>
        </FormField>

        <FormField
          label={`Total (${currency})`}
          htmlFor="total_cents"
          required
          error={state.errors?.total_cents}
        >
          <Input
            id="total_cents"
            name="total_cents"
            inputMode="decimal"
            required
            defaultValue={v.total_cents ?? defaults?.total_dollars ?? ""}
          />
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
