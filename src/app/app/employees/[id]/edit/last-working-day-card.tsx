"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setLastWorkingDayAction } from "../../actions";

/** "Friday, December 18, 2026" for a YYYY-MM-DD date. With the year: a
 *  last day is often months out, and "Sunday, December 31" does not say
 *  which December. */
function longDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The last date someone works. They stay active until then; after it, no
 * visit can have them on it, and setting it takes them off the ones already
 * booked (each marked "Needs cover"). Svitlana, 2026-11-23.
 */
export function LastWorkingDayCard({
  memberId,
  memberName,
  current,
}: {
  memberId: string;
  memberName: string;
  current: string | null;
}) {
  const [value, setValue] = useState(current ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const save = (next: string | null) =>
    startTransition(async () => {
      const res = await setLastWorkingDayAction(memberId, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (!res.lastDay) {
        toast.success(`${memberName} has no last working day now.`);
      } else if (res.removed.length > 0) {
        const n = res.removed.length;
        toast.success(
          `Saved. ${memberName} was taken off ${n} visit${n === 1 ? "" : "s"} after ${longDay(res.lastDay)}. ${
            n === 1 ? "It is" : "They are"
          } marked "Needs cover" on Bookings.`,
          { duration: 10_000 },
        );
      } else {
        toast.success(`Saved. ${memberName} can't be booked after ${longDay(res.lastDay)}.`);
      }
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-sm font-semibold">Last working day</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        For someone who is leaving. They stay active and keep their visits up to this date. After it,
        nobody can put them on a visit, and any visit they are already on after it loses them and is
        marked &ldquo;Needs cover&rdquo;. Deactivate them once they have gone.
      </p>
      {current && (
        <p className="mt-3 text-sm">
          {memberName}&rsquo;s last working day is <strong>{longDay(current)}</strong>.
        </p>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value) {
            toast.error("Pick a date.");
            return;
          }
          save(value);
        }}
      >
        <label className="grid gap-1 text-xs font-medium">
          Last day
          <Input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-44"
            disabled={pending}
            aria-label="Last working day"
          />
        </label>
        <Button type="submit" size="sm" disabled={pending || !value || value === current}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {current && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setValue("");
              save(null);
            }}
          >
            Clear
          </Button>
        )}
      </form>
    </div>
  );
}
