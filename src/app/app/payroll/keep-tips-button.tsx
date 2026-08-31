"use client";

import { keepTipsAction } from "./actions";

/**
 * "Keep in business" with a speed bump. Unlike "Mark paid" (which records a
 * handover that already happened), this button REMOVES money from a cleaner's
 * owed pile — a mis-click is a real wrong — so the confirm names the amount
 * and the person before anything settles.
 *
 * Two call shapes, matching keepTipsAction: a payroll bucket passes
 * membershipId ("" for the unattributed pile), an invoice page passes
 * invoiceId to absorb everything unsettled on that invoice.
 */
export function KeepTipsButton({
  membershipId,
  invoiceId,
  who,
  amountLabel,
}: {
  membershipId?: string | null;
  invoiceId?: string;
  /** Whose pile this is — empty for the unattributed bucket. */
  who?: string;
  amountLabel: string;
}) {
  const message = who
    ? `Keep ${amountLabel} in the business instead of passing it on to ${who}? This settles the tip — it will no longer show as owed.`
    : `Keep ${amountLabel} in the business? This settles the tip — it will no longer show as owed.`;
  return (
    <form
      action={keepTipsAction}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {membershipId !== undefined && (
        <input type="hidden" name="membership_id" value={membershipId ?? ""} />
      )}
      {invoiceId && <input type="hidden" name="invoice_id" value={invoiceId} />}
      <button
        type="submit"
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Keep in business
      </button>
    </form>
  );
}
