"use client";

import { useActionState, useState, useMemo } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { SetupReturnField } from "@/components/setup-return-field";
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";
import { computeTax, parseTaxRate } from "@/lib/invoice-tax";
import {
  createInvoiceAction,
  updateInvoiceAction,
  type InvoiceFormState,
} from "./actions";

const empty: InvoiceFormState = {};

type Defaults = {
  client_id?: string;
  booking_id?: string | null;
  status?: string;
  /** Pre-tax subtotal as a dollar string, e.g. "100.00". */
  subtotal_dollars?: string;
  due_date?: string | null;
  /** Tax rate in percent as a string, e.g. "5" or "12.5". Empty = no tax. */
  tax_rate_percent?: string;
  tax_label?: string | null;
};

export function InvoiceForm({
  mode,
  id,
  defaults,
  clients,
  bookings,
  currency = "CAD",
  /** Org's default tax settings. Used ONLY on create to pre-fill.
   *  On edit we use whatever was saved on the invoice itself. */
  orgDefaultTaxRatePercent,
  orgDefaultTaxLabel,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  clients: { id: string; label: string }[];
  bookings: { id: string; label: string }[];
  currency?: CurrencyCode;
  orgDefaultTaxRatePercent?: string;
  orgDefaultTaxLabel?: string;
}) {
  const action =
    mode === "create"
      ? createInvoiceAction
      : updateInvoiceAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

  // On create, pre-fill tax from the org default. On edit, use what
  // was saved on THIS invoice — we don't want to retroactively bump a
  // historical invoice when the owner changes their default next year.
  const initialTaxRate =
    mode === "create"
      ? orgDefaultTaxRatePercent ?? ""
      : defaults?.tax_rate_percent ?? "";
  const initialTaxLabel =
    mode === "create"
      ? orgDefaultTaxLabel ?? ""
      : defaults?.tax_label ?? "";

  const [taxEnabled, setTaxEnabled] = useState<boolean>(
    Boolean(initialTaxRate && initialTaxRate !== "0"),
  );
  const [subtotalText, setSubtotalText] = useState<string>(
    v.subtotal_cents ?? defaults?.subtotal_dollars ?? "",
  );
  const [rateText, setRateText] = useState<string>(
    v.tax_rate_bps ?? initialTaxRate,
  );
  const [labelText, setLabelText] = useState<string>(
    v.tax_label ?? initialTaxLabel,
  );

  // Live preview — compute subtotal / tax / total from the current
  // inputs so the owner sees what the client will see before saving.
  const preview = useMemo(() => {
    const subtotalDollars = Number(subtotalText);
    if (!Number.isFinite(subtotalDollars) || subtotalDollars < 0) return null;
    const subtotalCents = Math.round(subtotalDollars * 100);
    const rateBps = taxEnabled ? parseTaxRate(rateText) : null;
    return computeTax(subtotalCents, { rateBps });
  }, [subtotalText, rateText, taxEnabled]);

  return (
    <form action={formAction} className="space-y-5">
      <SetupReturnField />
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
        label="Linked booking"
        htmlFor="booking_id"
        error={state.errors?.booking_id}
        hint="Optional — link the booking this invoice covers"
      >
        <FormSelect
          id="booking_id"
          name="booking_id"
          defaultValue={v.booking_id ?? defaults?.booking_id ?? ""}
        >
          <option value="">— None —</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </FormSelect>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Status"
          htmlFor="status"
          required
          error={state.errors?.status}
          hint="Sent / paid dates auto-stamp on transition"
        >
          <FormSelect
            id="status"
            name="status"
            defaultValue={v.status ?? defaults?.status ?? "draft"}
          >
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </FormSelect>
        </FormField>

        <FormField
          label={`Subtotal (${currency})`}
          htmlFor="subtotal_cents"
          required
          error={state.errors?.subtotal_cents}
          hint={taxEnabled ? "Pre-tax amount — tax is added below" : undefined}
        >
          <Input
            id="subtotal_cents"
            name="subtotal_cents"
            inputMode="decimal"
            required
            value={subtotalText}
            onChange={(e) => setSubtotalText(e.target.value)}
          />
        </FormField>
      </div>

      {/* Tax section */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={taxEnabled}
            onChange={(e) => setTaxEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <div className="flex-1">
            <p className="text-sm font-medium">Add tax to this invoice</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shown to the client as a separate line on the invoice.
            </p>
          </div>
        </label>

        {taxEnabled && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Tax label"
              htmlFor="tax_label"
              error={state.errors?.tax_label}
              hint="What the client sees — GST, HST, VAT, etc."
            >
              <Input
                id="tax_label"
                name="tax_label"
                placeholder="GST"
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
              />
            </FormField>
            <FormField
              label="Rate (%)"
              htmlFor="tax_rate_bps"
              error={state.errors?.tax_rate_bps}
              hint="e.g. 5 for 5%, 12.5 for 12.5%"
            >
              <Input
                id="tax_rate_bps"
                name="tax_rate_bps"
                inputMode="decimal"
                placeholder="5"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
              />
            </FormField>
          </div>
        )}

        {/* When tax is off, submit an empty rate so the server clears
            tax fields on this invoice instead of preserving the old rate. */}
        {!taxEnabled && (
          <>
            <input type="hidden" name="tax_rate_bps" value="" />
            <input type="hidden" name="tax_label" value="" />
          </>
        )}

        {/* Live total preview */}
        {preview && (
          <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-mono tabular-nums">
                {formatCurrencyCents(preview.subtotalCents, currency)}
              </dd>
            </div>
            {preview.rateBps && preview.taxAmountCents !== null && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">
                  {labelText.trim() || "Tax"}{" "}
                  <span className="text-xs">
                    ({(preview.rateBps / 100)
                      .toFixed(2)
                      .replace(/\.?0+$/, "")}
                    %)
                  </span>
                </dt>
                <dd className="font-mono tabular-nums">
                  {formatCurrencyCents(preview.taxAmountCents, currency)}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <dt className="font-semibold">Total</dt>
              <dd className="font-mono font-bold tabular-nums">
                {formatCurrencyCents(preview.totalCents, currency)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <FormField
        label="Due date"
        htmlFor="due_date"
        error={state.errors?.due_date}
      >
        <Input
          id="due_date"
          name="due_date"
          type="date"
          defaultValue={v.due_date ?? defaults?.due_date ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/invoices"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create invoice" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
