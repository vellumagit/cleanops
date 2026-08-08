"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ENGAGEMENTS,
  ENGAGEMENT_LABEL,
  ENGAGEMENT_HELP,
  toEngagement,
  type Engagement,
} from "@/lib/engagement";

/**
 * Employee or subcontractor — the choice that decides which pay system a
 * person lands in.
 *
 * Shared by all three places a person can be added or changed (manual add,
 * invite, edit) so the wording and the values can't drift apart between them.
 * The help text updates as you change the selection because the consequence
 * is not guessable from the word alone: an owner picking "Subcontractor"
 * needs to see, before saving, that this person will stop appearing in
 * payroll and start appearing in Subcontractor pay.
 *
 * Deliberately sits next to Role and Pay rate but means neither of them:
 * Role is permissions, pay_type is the rate basis. A subcontractor can be a
 * manager on a flat rate.
 */
export function EngagementField({
  defaultValue,
  disabled,
  hint,
}: {
  defaultValue?: string | null;
  disabled?: boolean;
  hint?: string;
}) {
  const [value, setValue] = useState<Engagement>(toEngagement(defaultValue));

  return (
    <div className="space-y-1.5">
      <Label htmlFor="engagement">Engagement</Label>
      <Select
        name="engagement"
        value={value}
        onValueChange={(v) => setValue(toEngagement(v))}
        disabled={disabled}
      >
        <SelectTrigger id="engagement">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ENGAGEMENTS.map((e) => (
            <SelectItem key={e} value={e}>
              {ENGAGEMENT_LABEL[e]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {ENGAGEMENT_HELP[value]}
        {hint ? ` ${hint}` : ""}
      </p>
    </div>
  );
}
