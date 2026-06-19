"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setApplicantStatusAction } from "./actions";

const STAGES = [
  { key: "new", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "interview", label: "Interview" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
] as const;

/**
 * Compact stage selector for the applicants list, so owners can advance
 * the pipeline without opening each applicant. Lives outside the row's
 * link so changing the stage doesn't navigate.
 */
export function ApplicantQuickStatus({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="Stage"
      value={status}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        if (next === status) return;
        startTransition(async () => {
          const res = await setApplicantStatusAction(id, next);
          if (res.ok) {
            toast.success(`Moved to ${next}`);
            router.refresh();
          } else {
            toast.error(res.error);
          }
        });
      }}
      className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-medium capitalize outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
    >
      {STAGES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
