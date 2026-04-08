"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { BonusRuleSchema } from "@/lib/validators/bonus-rules";

type Field = keyof typeof BonusRuleSchema.shape;
export type BonusRuleFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    enabled: String(formData.get("enabled") ?? ""),
    min_avg_rating: String(formData.get("min_avg_rating") ?? ""),
    min_reviews_count: String(formData.get("min_reviews_count") ?? ""),
    period_days: String(formData.get("period_days") ?? ""),
    amount_cents: String(formData.get("amount_cents") ?? ""),
  };
}

export async function upsertBonusRuleAction(
  _prev: BonusRuleFormState,
  formData: FormData,
): Promise<BonusRuleFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(BonusRuleSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("bonus_rules").upsert(
    {
      organization_id: membership.organization_id,
      enabled: parsed.data.enabled,
      min_avg_rating: parsed.data.min_avg_rating,
      min_reviews_count: parsed.data.min_reviews_count,
      period_days: parsed.data.period_days,
      amount_cents: parsed.data.amount_cents,
    },
    { onConflict: "organization_id" },
  );

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/settings/bonus-rules");
  revalidatePath("/app/bonuses");
  return { values: raw };
}
