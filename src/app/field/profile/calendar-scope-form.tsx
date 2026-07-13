"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import {
  updateCalendarScopeAction,
  type CalendarScopeState,
} from "./actions";

const empty: CalendarScopeState = {};

// Google Calendar event colors (id → swatch).
const COLORS = [
  { id: "6", name: "Orange", hex: "#F09300" },
  { id: "11", name: "Red", hex: "#D50000" },
  { id: "10", name: "Green", hex: "#0B8043" },
  { id: "7", name: "Blue", hex: "#039BE5" },
  { id: "3", name: "Purple", hex: "#8E24AA" },
  { id: "5", name: "Yellow", hex: "#F6BF26" },
];

export function CalendarScopeForm({
  scope,
  color,
}: {
  scope: string;
  color: string;
}) {
  const [state, action] = useActionState(updateCalendarScopeAction, empty);

  useEffect(() => {
    if (state.ok) toast.success("Saved — updating your calendar…");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-3">
        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="calendar_scope"
            value="mine"
            defaultChecked={scope !== "all"}
            className="mt-1 h-4 w-4"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Only my jobs</span>
            <span className="text-xs text-muted-foreground">
              Your calendar shows just the jobs assigned to you.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="calendar_scope"
            value="all"
            defaultChecked={scope === "all"}
            className="mt-1 h-4 w-4"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">All organization jobs</span>
            <span className="text-xs text-muted-foreground">
              See the whole team&apos;s schedule on your calendar, with your own
              jobs highlighted in your color.
            </span>
          </span>
        </label>
      </fieldset>

      <div>
        <div className="mb-2 text-xs font-medium">Highlight my jobs in</div>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <label key={c.id} className="cursor-pointer" title={c.name}>
              <input
                type="radio"
                name="calendar_color"
                value={c.id}
                defaultChecked={color === c.id}
                className="peer sr-only"
              />
              <span
                className="block h-8 w-8 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-background transition peer-checked:ring-foreground"
                style={{ backgroundColor: c.hex }}
              />
            </label>
          ))}
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Save calendar preference</SubmitButton>
    </form>
  );
}
