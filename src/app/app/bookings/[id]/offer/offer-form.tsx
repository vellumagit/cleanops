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
type Member = { id: string; name: string; phone: string | null };

type Props = {
  /** Org IANA timezone. composeOfferSms on the server takes one explicitly,
   *  so without it here the preview and the message actually sent disagree —
   *  and the preview is the only thing anyone checks first. */
  tz: string;
  bookingId: string;
  contacts: Contact[];
  /** The org's own roster subcontractors (memberships). Separate group with
   *  a separate deal: usual rate from clocked hours, never the flat pay. */
  members: Member[];
  booking: {
    scheduled_at: string;
    duration_minutes: number;
    service_type: string;
    address: string | null;
  };
};

/**
 * Client component — two recipient groups ("Your subcontractors" and the
 * on-call pool), the pay dollar field (on-call only), positions needed, and
 * a live preview of each SMS variant so the admin sees exactly what will go
 * out before hitting send.
 */
export function JobOfferForm({
  bookingId,
  contacts,
  members,
  booking,
  tz,
}: Props) {
  const [state, formAction] = useActionState(createJobOfferAction, empty);

  const textableMembers = useMemo(
    () => members.filter((m) => m.phone),
    [members],
  );

  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(
    () => new Set(contacts.map((c) => c.id)),
  );
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    () => new Set(textableMembers.map((m) => m.id)),
  );
  const [payDollars, setPayDollars] = useState<string>("180");
  const [positionsNeeded, setPositionsNeeded] = useState<number>(1);

  function toggleIn(
    set: (fn: (prev: Set<string>) => Set<string>) => void,
    id: string,
  ) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalSelected = selectedContacts.size + selectedMembers.size;
  const showPay = selectedContacts.size > 0;

  // Live SMS previews — each matches its composeOfferSms() variant on the
  // server, including the STOP disclosure that only on-call texts carry.
  const previews = useMemo(() => {
    const when = new Date(booking.scheduled_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
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
    const cta =
      positionsNeeded > 1
        ? `${positionsNeeded} spots available — claim yours`
        : "First to claim gets it";
    const link = "https://…/claim/<token>";
    return {
      oncall: `Sollos 3: Coverage needed. ${service} ${when}, ${duration}, ${dollars}. ${addrShort}. ${cta}: ${link} Reply STOP to opt out.`,
      roster: `Sollos 3: Open shift. ${service} ${when}, ${duration}. ${addrShort}. Paid at your usual rate. ${cta}: ${link}`,
    };
  }, [booking, payDollars, positionsNeeded, tz]);

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />
      <input type="hidden" name="booking_id" value={bookingId} />

      <div className="grid gap-5 sm:grid-cols-3">
        {showPay ? (
          <FormField
            label="On-call pay ($)"
            htmlFor="pay_dollars"
            required
            error={state.errors?.pay_dollars}
            hint="Flat amount per on-call cleaner. Your subcontractors keep their usual rate."
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
        ) : (
          // No on-call recipients — the flat pay describes a deal nobody on
          // this offer is getting, so it isn't asked for (and stores as 0).
          <input type="hidden" name="pay_dollars" value="0" />
        )}

        <FormField
          label="Positions needed"
          htmlFor="positions_needed"
          required
          error={state.errors?.positions_needed}
          hint="How many cleaners needed."
        >
          <Input
            id="positions_needed"
            name="positions_needed"
            type="number"
            min={1}
            max={50}
            required
            value={positionsNeeded}
            onChange={(e) =>
              setPositionsNeeded(Math.max(1, Number(e.target.value) || 1))
            }
          />
        </FormField>

        <FormField
          label="Expires in (minutes)"
          htmlFor="expires_in_minutes"
          required
          error={state.errors?.expires_in_minutes}
          hint="5 to 1440 (24 hours)."
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

      {/* Recipients — two groups, two deals. */}
      <FormField
        label={`Recipients (${totalSelected} selected)`}
        htmlFor="contact_ids"
        required
        error={state.errors?.contact_ids}
      >
        <div className="space-y-3">
          {members.length > 0 && (
            <RecipientGroup
              title="Your subcontractors"
              subtitle="Claiming assigns them the job — paid their usual rate."
              selectedCount={selectedMembers.size}
              totalCount={textableMembers.length}
              onToggleAll={() =>
                setSelectedMembers((prev) =>
                  prev.size === textableMembers.length
                    ? new Set()
                    : new Set(textableMembers.map((m) => m.id)),
                )
              }
            >
              {members.map((m) => (
                <RecipientRow
                  key={m.id}
                  inputName="member_ids"
                  id={m.id}
                  name={m.name}
                  phone={m.phone ?? "no phone on file"}
                  disabled={!m.phone}
                  checked={selectedMembers.has(m.id)}
                  onToggle={() => toggleIn(setSelectedMembers, m.id)}
                />
              ))}
            </RecipientGroup>
          )}

          {contacts.length > 0 && (
            <RecipientGroup
              title="On-call pool"
              subtitle="External cleaners — earn the flat pay per claimed job."
              selectedCount={selectedContacts.size}
              totalCount={contacts.length}
              onToggleAll={() =>
                setSelectedContacts((prev) =>
                  prev.size === contacts.length
                    ? new Set()
                    : new Set(contacts.map((c) => c.id)),
                )
              }
            >
              {contacts.map((c) => (
                <RecipientRow
                  key={c.id}
                  inputName="contact_ids"
                  id={c.id}
                  name={c.full_name}
                  phone={c.phone}
                  checked={selectedContacts.has(c.id)}
                  onToggle={() => toggleIn(setSelectedContacts, c.id)}
                />
              ))}
            </RecipientGroup>
          )}
        </div>
      </FormField>

      {/* SMS previews — one per selected group */}
      {selectedMembers.size > 0 && (
        <SmsPreview label="SMS to your subcontractors" body={previews.roster} />
      )}
      {selectedContacts.size > 0 && (
        <SmsPreview label="SMS to on-call cleaners" body={previews.oncall} />
      )}
      {totalSelected > 0 && (
        <p className="text-[11px] text-muted-foreground">
          The real link will use a unique claim token per recipient. Going
          over 160 chars doubles the per-message cost.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href={`/app/bookings/${bookingId}`}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton
          pendingLabel="Broadcasting…"
          disabled={totalSelected === 0}
        >
          Send to {totalSelected} recipient{totalSelected === 1 ? "" : "s"}
        </SubmitButton>
      </div>
    </form>
  );
}

function RecipientGroup({
  title,
  subtitle,
  selectedCount,
  totalCount,
  onToggleAll,
  children,
}: {
  title: string;
  subtitle: string;
  selectedCount: number;
  totalCount: number;
  onToggleAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-foreground">
            {title}{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              ({selectedCount} of {totalCount})
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onToggleAll}
          className="text-xs font-medium text-primary hover:underline"
        >
          {selectedCount === totalCount ? "Deselect all" : "Select all"}
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto">{children}</ul>
    </div>
  );
}

function RecipientRow({
  inputName,
  id,
  name,
  phone,
  checked,
  disabled,
  onToggle,
}: {
  inputName: "contact_ids" | "member_ids";
  id: string;
  name: string;
  phone: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={`flex items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 ${
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-muted/30"
        }`}
      >
        <input
          type="checkbox"
          name={inputName}
          value={id}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="h-4 w-4 rounded border-input"
        />
        <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <span className="truncate font-medium">{name}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {phone}
          </span>
        </div>
      </label>
    </li>
  );
}

function SmsPreview({ label, body }: { label: string; body: string }) {
  const segments = Math.max(1, Math.ceil(body.length / 160));
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="sollos-label">{label}</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {body.length} chars · {segments} segment{segments === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
        {body}
      </p>
    </div>
  );
}
