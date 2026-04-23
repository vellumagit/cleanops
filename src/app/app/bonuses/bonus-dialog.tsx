"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-field";
import {
  createAdHocBonusAction,
  updateBonusAction,
  deleteBonusAction,
} from "./actions";

export type BonusEmployeeOption = {
  id: string;
  name: string;
};

export type EditingBonus = {
  id: string;
  employee_name: string | null;
  amount_cents: number;
  reason: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  editing: EditingBonus | null;
  employees: BonusEmployeeOption[];
};

function centsToDollarString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function BonusDialog({
  open,
  onOpenChange,
  mode,
  editing,
  employees,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && editing) {
      setEmployeeId(""); // employee not editable on an existing bonus
      setAmount(centsToDollarString(editing.amount_cents));
      setReason(editing.reason ?? "");
    } else {
      setEmployeeId(employees[0]?.id ?? "");
      setAmount("");
      setReason("");
      const today = new Date().toISOString().slice(0, 10);
      setPeriodStart(today);
      setPeriodEnd(today);
    }
    setFormError(null);
  }, [open, mode, editing, employees]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      if (mode === "edit" && editing) {
        const fd = new FormData();
        fd.set("id", editing.id);
        fd.set("amount_dollars", amount);
        fd.set("reason", reason);
        const res = await updateBonusAction(fd);
        if (!res.ok) {
          setFormError(res.error);
          return;
        }
        toast.success("Bonus updated");
      } else {
        const fd = new FormData();
        fd.set("employee_id", employeeId);
        fd.set("amount_dollars", amount);
        fd.set("reason", reason);
        fd.set("period_start", periodStart);
        fd.set("period_end", periodEnd);
        const res = await createAdHocBonusAction(fd);
        if (!res.ok) {
          setFormError(res.error);
          return;
        }
        toast.success("Bonus added");
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!editing) return;
    if (!confirm("Delete this bonus? This can't be undone.")) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", editing.id);
      const res = await deleteBonusAction(fd);
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      toast.success("Bonus deleted");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit bonus" : "Add bonus"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? `Adjust the amount or reason for ${editing?.employee_name ?? "this bonus"}.`
              : "Issue a one-off bonus outside the rule engine — a discretionary award, a milestone spiff, or any ad-hoc payout."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          )}

          {mode === "create" && (
            <div className="space-y-1.5">
              <Label htmlFor="employee_id">Employee</Label>
              <FormSelect
                id="employee_id"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
              >
                <option value="">Pick an employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </FormSelect>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="amount_dollars">Amount ($)</Label>
            <Input
              id="amount_dollars"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.00"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">
              Reason{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Referral spiff, 5-year anniversary, outstanding month"
            />
          </div>

          {mode === "create" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="period_start">Period start</Label>
                <Input
                  id="period_start"
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period_end">Period end</Label>
                <Input
                  id="period_end"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            {mode === "edit" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={pending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {mode === "edit" ? (
                  <>
                    <Pencil className="h-4 w-4" />
                    {pending ? "Saving…" : "Save changes"}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {pending ? "Saving…" : "Add bonus"}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
