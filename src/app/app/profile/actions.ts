"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { ProfileSchema } from "@/lib/validators/profile";

type Field = keyof typeof ProfileSchema.shape;
export type ProfileFormState = ActionState<Field>;

/**
 * Let an owner/admin/manager set their own name + phone from the admin console
 * (the field-app profile already does this for cleaners). Writes profiles.
 * full_name, which drives how they appear everywhere via memberDisplayName —
 * so they show as themselves instead of falling back to their email.
 */
export async function updateMyProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = {
    full_name: String(formData.get("full_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
  const parsed = parseForm(ProfileSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone ?? null,
    })
    .eq("id", membership.profile_id);

  if (error) return { errors: { _form: error.message }, values: raw };

  revalidatePath("/app/profile");
  revalidatePath("/app");
  revalidatePath("/field");
  return { values: raw };
}
