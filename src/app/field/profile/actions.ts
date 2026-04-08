"use server";

import { revalidatePath } from "next/cache";
import {
  getActionContext,
  parseForm,
  type ActionState,
} from "@/lib/actions";
import { ProfileSchema } from "@/lib/validators/profile";

type Field = keyof typeof ProfileSchema.shape;
export type ProfileFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    full_name: String(formData.get("full_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
}

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = readFormValues(formData);
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

  revalidatePath("/field/profile");
  revalidatePath("/field");
  revalidatePath("/app");
  return { values: raw };
}
