"use client";

import { useTransition } from "react";
import { Calculator, Star, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { computeBonusesAction, computeEfficiencyBonusesAction } from "./actions";

function showResult(label: string, res: { ok: true; created: number; skipped: number } | { ok: false; error: string }) {
  if (res.ok) {
    toast.success(
      res.created === 0
        ? `${label}: no new bonuses (${res.skipped} skipped)`
        : `${label}: ${res.created} bonus${res.created === 1 ? "" : "es"} created`,
    );
  } else {
    toast.error(`${label}: ${res.error}`);
  }
}

export function ComputeBonusesButton() {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await computeBonusesAction();
            showResult("Reviews", res);
          })
        }
        className="gap-1.5"
      >
        <Star className="h-3.5 w-3.5" />
        {pending ? "Computing…" : "Review bonuses"}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await computeEfficiencyBonusesAction();
            showResult("Efficiency", res);
          })
        }
        className="gap-1.5"
      >
        <Zap className="h-3.5 w-3.5" />
        {pending ? "Computing…" : "Efficiency bonuses"}
      </Button>

      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const [reviewRes, effRes] = await Promise.all([
              computeBonusesAction(),
              computeEfficiencyBonusesAction(),
            ]);
            showResult("Reviews", reviewRes);
            showResult("Efficiency", effRes);
          })
        }
        className="gap-1.5"
      >
        <Calculator className="h-3.5 w-3.5" />
        {pending ? "Computing…" : "Compute all"}
      </Button>
    </div>
  );
}
