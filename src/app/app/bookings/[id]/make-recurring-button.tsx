"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Repeat, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { convertBookingToRecurringAction } from "../actions";

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "bi_weekly", label: "Every 2 weeks" },
  { value: "tri_weekly", label: "Every 3 weeks" },
  { value: "quad_weekly", label: "Every 4 weeks" },
  { value: "monthly", label: "Monthly (same date)" },
];

export function MakeRecurringButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("weekly");
  const [pending, startTransition] = useTransition();

  function submit() {
    const fd = new FormData();
    fd.append("pattern", pattern);
    startTransition(async () => {
      const res = await convertBookingToRecurringAction(bookingId, fd);
      if (res.ok) {
        toast.success("Recurring series created");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
          />
        }
      >
        <Repeat className="h-4 w-4" />
        Make recurring
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make this booking recurring</DialogTitle>
          <DialogDescription>
            This visit stays as the first one. We&rsquo;ll schedule future
            visits on the same weekday and time at the frequency you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label htmlFor="frequency" className="text-sm font-medium">
            Frequency
          </label>
          <select
            id="frequency"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Repeat className="h-4 w-4" />
            )}
            Create series
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
