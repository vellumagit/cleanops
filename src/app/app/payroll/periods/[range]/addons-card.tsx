"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/form-field";
import { ADDON_KINDS, ADDON_LABEL, type AddonKind } from "@/lib/pay-addons";
import { createAddonAction, deleteAddonAction } from "../../addon-actions";

export type AddonListRow = {
  id: string;
  name: string;
  kind: AddonKind;
  amountLabel: string;
  dayLabel: string;
  note: string;
  onStatement: boolean;
};

/**
 * Travel, reimbursements and other fixed amounts for contractors, in this
 * pay period. Preparing the period puts them on each person's statement.
 */
export function AddonsCard({
  rows,
  people,
  defaultDate,
  minDate,
  maxDate,
  totalLabel,
  canManage,
  statementPrepared,
}: {
  rows: AddonListRow[];
  people: Array<{ id: string; name: string }>;
  defaultDate: string;
  minDate: string;
  maxDate: string;
  totalLabel: string | null;
  canManage: boolean;
  statementPrepared: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const r = await createAddonAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("Added");
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const r = await deleteAddonAction(fd);
      if (!r.ok) toast.error(r.error);
      else router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Add-ons</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Travel, reimbursements and other amounts on top of a contractor&rsquo;s hours.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalLabel && <span className="text-lg font-bold tabular-nums">{totalLabel}</span>}
          {canManage && !open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={people.length === 0}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
      </div>

      {open && (
        <form ref={formRef} action={submit} className="grid gap-3 border-b border-border bg-muted/30 px-5 py-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="addon-person">For</Label>
            <FormSelect id="addon-person" name="membership_id" required defaultValue="">
              <option value="" disabled>
                Pick someone
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addon-kind">What for</Label>
            <FormSelect id="addon-kind" name="kind" required defaultValue="reimbursement">
              {ADDON_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addon-amount">Amount ($)</Label>
            <Input id="addon-amount" name="amount" inputMode="decimal" placeholder="25.00" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addon-date">Day</Label>
            <Input
              id="addon-date"
              name="work_date"
              type="date"
              defaultValue={defaultDate}
              min={minDate}
              max={maxDate}
              required
              className="w-auto"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="addon-note">Note</Label>
            <Input id="addon-note" name="note" maxLength={300} placeholder="Parking at the Smith job" required />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save add-on"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          {people.length === 0 ? "Nobody here is paid as a contractor." : "None this period."}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {r.name} <span className="font-normal text-muted-foreground">· {ADDON_LABEL[r.kind]}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.dayLabel} · {r.note}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {r.onStatement ? "On statement" : "Waiting"}
                </span>
                <span className="font-semibold tabular-nums">{r.amountLabel}</span>
                {canManage && !r.onStatement && (
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    disabled={pending}
                    aria-label={`Remove ${r.note}`}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
        {statementPrepared
          ? "This period's contractor statement is already prepared. To add something now, delete the statement on Contractor pay, add it, then prepare the period again."
          : "Preparing this period puts each add-on on that person's contractor statement. Reimbursements are kept apart from earnings."}
      </p>
    </section>
  );
}
