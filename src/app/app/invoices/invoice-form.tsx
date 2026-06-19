"use client";

import { useActionState, useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { Search, X, ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { SetupReturnField } from "@/components/setup-return-field";
import {
  formatCurrencyCents,
  humanizeEnum,
  type CurrencyCode,
} from "@/lib/format";
import { computeTax, parseTaxRate } from "@/lib/invoice-tax";
import {
  createInvoiceAction,
  updateInvoiceAction,
  type InvoiceFormState,
} from "./actions";
import type { BookingOption } from "./options";

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

// ---------------------------------------------------------------------------
// Booking combobox — replaces the flat 200-item select
// ---------------------------------------------------------------------------

function BookingCombobox({
  bookings,
  clientId,
  value,
  onChange,
}: {
  bookings: BookingOption[];
  clientId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filter bookings: if a client is selected, only show their bookings
  const clientBookings = useMemo(() => {
    if (!clientId) return bookings;
    return bookings.filter((b) => b.client_id === clientId);
  }, [bookings, clientId]);

  // Then apply the search query
  const filtered = useMemo(() => {
    if (!query.trim()) return clientBookings;
    const needle = query.trim().toLowerCase();
    return clientBookings.filter(
      (b) =>
        b.client_name.toLowerCase().includes(needle) ||
        b.service_type.toLowerCase().includes(needle) ||
        b.status.toLowerCase().includes(needle) ||
        new Date(b.scheduled_at)
          .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          .toLowerCase()
          .includes(needle),
    );
  }, [clientBookings, query]);

  const selected = bookings.find((b) => b.id === value);

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function formatBookingLabel(b: BookingOption) {
    const date = new Date(b.scheduled_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const svc = humanizeEnum(b.service_type);
    return `${date} · ${svc}`;
  }

  const statusColor: Record<string, string> = {
    completed: "text-emerald-600 dark:text-emerald-400",
    confirmed: "text-blue-600 dark:text-blue-400",
    pending: "text-amber-600 dark:text-amber-400",
    cancelled: "text-muted-foreground",
    in_progress: "text-blue-600 dark:text-blue-400",
    en_route: "text-blue-600 dark:text-blue-400",
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          // Focus the search input next tick
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate font-medium">{formatBookingLabel(selected)}</span>
            <span className={`shrink-0 text-xs ${statusColor[selected.status] ?? "text-muted-foreground"}`}>
              {humanizeEnum(selected.status)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatCurrencyCents(selected.total_cents)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {clientId
              ? clientBookings.length === 0
                ? "No bookings for this client"
                : "Select a booking…"
              : "Select a client first, or search all bookings…"}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1 ml-2">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                select("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  select("");
                }
              }}
              className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear booking"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {/* Search bar — deliberately prominent */}
          <div className="border-b border-border bg-muted/60 px-3 py-2.5">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to search by date, service, or client…"
                className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <ul className="max-h-56 overflow-y-auto py-1">
            {/* None option */}
            <li>
              <button
                type="button"
                onClick={() => select("")}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <span className="w-4 shrink-0">
                  {!value && <Check className="h-3.5 w-3.5 text-primary" />}
                </span>
                — None —
              </button>
            </li>

            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                {query ? "No bookings match your search." : "No bookings found."}
              </li>
            ) : (
              filtered.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => select(b.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                  >
                    <span className="w-4 shrink-0">
                      {value === b.id && (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0 text-left">
                      <span className="block font-medium leading-tight">{formatBookingLabel(b)}</span>
                      <span className="block text-xs text-muted-foreground leading-tight mt-0.5">
                        {b.client_name}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs ${statusColor[b.status] ?? "text-muted-foreground"}`}
                    >
                      {humanizeEnum(b.status)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatCurrencyCents(b.total_cents)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {/* Footer hint */}
          {clientId && clientBookings.length > 0 && (
            <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
              {filtered.length} of {clientBookings.length} booking
              {clientBookings.length !== 1 ? "s" : ""} for this client
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main invoice form
// ---------------------------------------------------------------------------

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
  /** When this invoice has line items, the line-items editor below owns
   *  the subtotal + tax. This form then hides its own money fields and
   *  leaves amount_cents untouched on save, so the two forms can't fight
   *  over the total. */
  lineItemsMode = false,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  clients: { id: string; label: string }[];
  bookings: BookingOption[];
  currency?: CurrencyCode;
  orgDefaultTaxRatePercent?: string;
  orgDefaultTaxLabel?: string;
  lineItemsMode?: boolean;
}) {
  const action =
    mode === "create"
      ? createInvoiceAction
      : updateInvoiceAction.bind(null, id ?? "");
  const [state, formAction] = useActionState(action, empty);
  const v = state.values ?? {};

  const [clientId, setClientId] = useState<string>(
    v.client_id ?? defaults?.client_id ?? "",
  );
  const [bookingId, setBookingId] = useState<string>(
    v.booking_id ?? defaults?.booking_id ?? "",
  );

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

  const statusField = (
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
  );

  return (
    <form action={formAction} className="space-y-5">
      <SetupReturnField />
      <FormError message={state.errors?._form} />

      {/* Hidden inputs carry the combobox selections to the server */}
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="booking_id" value={bookingId} />

      <FormField
        label="Client"
        htmlFor="client_id_select"
        required
        error={state.errors?.client_id}
      >
        <FormSelect
          id="client_id_select"
          name="_client_id_display"
          required
          value={clientId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setClientId(e.target.value);
            // Clear the booking selection when client changes — the old
            // booking likely belongs to a different client.
            setBookingId("");
          }}
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
        htmlFor="booking_combobox"
        error={state.errors?.booking_id}
        hint={
          clientId
            ? "Showing this client's bookings — search by date or service"
            : "Select a client above to filter bookings, or search all"
        }
      >
        <BookingCombobox
          bookings={bookings}
          clientId={clientId}
          value={bookingId}
          onChange={setBookingId}
        />
      </FormField>

      {lineItemsMode ? (
        <>
          {statusField}
          {/* Line items below own the money. Carry the saved subtotal so
              validation passes, but updateInvoiceAction ignores it and
              leaves amount_cents / tax untouched. */}
          <input type="hidden" name="subtotal_cents" value={subtotalText} />
          <input type="hidden" name="tax_rate_bps" value="" />
          <input type="hidden" name="tax_label" value="" />
          <input type="hidden" name="totals_managed_elsewhere" value="1" />
          <p className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            The subtotal and tax for this invoice are calculated from its
            line items below. Edit them in the <strong>Line items</strong>{" "}
            section.
          </p>
        </>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            {statusField}

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
        </>
      )}

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
