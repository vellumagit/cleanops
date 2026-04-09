"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createJobOfferAction,
  type JobOfferFormState,
} from "../../../freelancers/actions";

const empty: JobOfferFormState = {};

type Contact = { id: string; full_name: string; phone: string };

type Props = {
  bookingId: string;
  contacts: Contact[];
  booking: {
    scheduled_at: string;
    duration_minutes: number;
    service_type: string;
    address: string | null;
  };
};

/**
 * Client component — handles the multi-select checkboxes, the pay dollar
 * field, and a live preview of the rendered SMS text so the admin sees
 * exactly what will go out before hitting send.
 */
export function JobOfferForm({ bookingId, contacts, booking }: Props) {
  const [state, formAction] = useActionState(createJobOfferAction, empty);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(contacts.map((c) => c.id)),
  );
  const [payDollars, setPayDollars] = useState<string>("180");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === contacts.length
        ? new Set()
        : new Set(contacts.map((c) => c.id)),
    );
  }

  // Live SMS preview — matches composeOfferSms() on the server.
  const preview = useMemo(() => {
    const when = new Date(booking.scheduled_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const duration =
      booking.duration_minutes >= 60
        ? `${Math.round((booking.duration_minutes / 60) * 10) / 10} hrs`
        : `${booking.duration_minutes} min`;
    const payNum = Number(payDollars.replace(/[$,\s]/g, ""));
    const dollars = Number.isFinite(payNum) ? `$${Math.round(payNum)}` : "$?";
    const service = booking.service_type.replace(/_/g, " ");
    const addr = booking.address?.split("\n")[0]?.trim() ?? "On-site";
    const addrShort = addr.length > 60 ? addr.slice(0, 57) + "…" : addr;
    return `Sollos 3: Coverage needed. ${service} ${when}, ${duration}, ${dollars}. ${addrShort}. First to claim gets it: https://…/claim/<token>`;
  }, [booking, payDollars]);

  const segmentCount = Math.max(1, Math.ceil(preview.length / 160));

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />
      <input type="hidden" name="booking_id" value={bookingId} />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Pay ($)"
          htmlFor="pay_dollars"
          required
          error={state.errors?.pay_dollars}
          hint="Flat amount offered to the freelancer who claims this shift."
        >
          <Input
            id="pay_dollars"
            name="pay_dollars"
            type="text"
            inputMode="decimal"
            required
            value={payDollars}
            onChange={(e) => setPayDollars(e.target.value)}
          />
        </FormField>

        <FormField
          label="Expires in (minutes)"
          htmlFor="expires_in_minutes"
          required
          error={state.errors?.expires_in_minutes}
          hint="Between 5 and 1440 (24 hours)."
        >
          <Input
            id="expires_in_minutes"
            name="expires_in_minutes"
            type="number"
            min={5}
            max={1440}
            step={5}
            required
            defaultValue="30"
          />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="Optional — not included in the SMS body, only visible to admins."
        />
      </FormField>

      {/* Contact multi-select */}
      <FormField
        label={`Recipients (${selected.size} of ${contacts.length})`}
        htmlFor="contact_ids"
        required
        error={state.errors?.contact_ids}
      >
        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-primary hover:underline"
            >
              {selected.size === contacts.length
                ? "Deselect all"
                : "Select all"}
            </button>
            <span className="text-[11px] text-muted-foreground">
              Inactive contacts are hidden
            </span>
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {contacts.map((c) => {
              const checked = selected.has(c.id);
              return (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/30">
                    <input
                      type="checkbox"
                      name="contact_ids"
                      value={c.id}
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      className="h-4 w-4 rounded border-input"
                    />
                    <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                      <span className="truncate font-medium">
                        {c.full_name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {c.phone}
                      </span>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </FormField>

      {/* SMS preview */}
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="flex items-center justify-between">
          <p className="sollos-label">SMS preview</p>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {preview.length} chars · {segmentCount} segment
            {segmentCount === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
          {preview}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The real link will use a unique claim token per recipient. Going
          over 160 chars doubles the per-message cost.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href={`/app/bookings/${bookingId}`}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Broadcasting…">
          Send to {selected.size} freelancer{selected.size === 1 ? "" : "s"}
        </SubmitButton>
      </div>
    </form>
  );
}
