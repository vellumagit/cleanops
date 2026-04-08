"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleStepAction } from "../actions";

export function StepToggle({
  moduleId,
  stepId,
  done,
}: {
  moduleId: string;
  stepId: string;
  done: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("module_id", moduleId);
      fd.set("step_id", stepId);
      fd.set("desired", done ? "incomplete" : "complete");
      const result = await toggleStepAction(fd);
      if (result.ok) {
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={done}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        done
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-border bg-background text-transparent hover:border-foreground",
        isPending && "opacity-60",
      )}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </button>
  );
}
