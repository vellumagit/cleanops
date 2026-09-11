"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSageAccountMapAction } from "./sage-actions";

type Option = { id: string; label: string; type: string };

type Row = {
  key:
    | "sales_ledger_account_id"
    | "bank_account_id"
    | "payroll_wages_ledger_account_id"
    | "payroll_liability_ledger_account_id"
    | "payroll_contractor_ledger_account_id";
  label: string;
  hint: string;
  kind: "ledger" | "bank";
};

const ROWS: Row[] = [
  {
    key: "sales_ledger_account_id",
    label: "Sales",
    hint: "Every invoice line posts here.",
    kind: "ledger",
  },
  {
    key: "bank_account_id",
    label: "Bank",
    hint: "Customer receipts land here; contractor payments leave from here.",
    kind: "bank",
  },
  {
    key: "payroll_wages_ledger_account_id",
    label: "Wages",
    hint: "Gross employee pay, one line per person per run.",
    kind: "ledger",
  },
  {
    key: "payroll_liability_ledger_account_id",
    label: "Wages payable",
    hint: "Holds gross pay until the bank feed shows what went out.",
    kind: "ledger",
  },
  {
    key: "payroll_contractor_ledger_account_id",
    label: "Contractor costs",
    hint: "Subcontractor bills post here.",
    kind: "ledger",
  },
];

/**
 * Which Sage accounts Sollos posts to. Auto-detected by name on first use;
 * this is where the owner or their bookkeeper sees the choice and changes
 * it. "Auto" means Sollos will pick again next time it posts.
 */
export function SageAccountsForm({
  current,
  ledger,
  bank,
  loadError,
}: {
  current: Record<Row["key"], string | null>;
  ledger: Option[];
  bank: Option[];
  loadError: string | null;
}) {
  const [values, setValues] = useState<Record<Row["key"], string>>({
    sales_ledger_account_id: current.sales_ledger_account_id ?? "",
    bank_account_id: current.bank_account_id ?? "",
    payroll_wages_ledger_account_id: current.payroll_wages_ledger_account_id ?? "",
    payroll_liability_ledger_account_id: current.payroll_liability_ledger_account_id ?? "",
    payroll_contractor_ledger_account_id: current.payroll_contractor_ledger_account_id ?? "",
  });
  const [pending, startTransition] = useTransition();
  const dirty = ROWS.some((r) => (current[r.key] ?? "") !== values[r.key]);

  function save() {
    startTransition(async () => {
      const res = await saveSageAccountMapAction(values);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save — please try again.");
        return;
      }
      toast.success("Sage accounts saved.");
    });
  }

  const byType = (opts: Option[]) => {
    const groups = new Map<string, Option[]>();
    for (const o of opts) {
      const g = groups.get(o.type || "Other") ?? [];
      g.push(o);
      groups.set(o.type || "Other", g);
    }
    return [...groups.entries()];
  };

  return (
    <div className="mt-3 rounded-md border border-border bg-background/50 p-2 text-left">
      <p className="text-[11px] font-medium text-foreground">Accounts Sollos posts to</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Picked by name from your chart the first time each thing posts. Change
        any of them here; your bookkeeper will know which.
      </p>
      {loadError && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          Couldn&apos;t load the chart from Sage ({loadError}). Showing saved ids
          only.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {ROWS.map((r) => {
          const opts = r.kind === "bank" ? bank : ledger;
          const v = values[r.key];
          const known = opts.some((o) => o.id === v);
          return (
            <div key={r.key}>
              <label
                htmlFor={`sage-acct-${r.key}`}
                className="block text-[11px] font-medium"
              >
                {r.label}{" "}
                <span className="font-normal text-muted-foreground">— {r.hint}</span>
              </label>
              <select
                id={`sage-acct-${r.key}`}
                value={known ? v : v ? "__unknown" : ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [r.key]: e.target.value === "__unknown" ? v : e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Auto (pick by name)</option>
                {!known && v ? (
                  <option value="__unknown">Saved id {v.slice(0, 8)}…</option>
                ) : null}
                {byType(opts).map(([type, list]) => (
                  <optgroup key={type} label={type}>
                    {list.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty}
        className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save accounts"}
      </button>
    </div>
  );
}
