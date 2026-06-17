"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

function newToken(): string {
  return `frm_${randomUUID().replace(/-/g, "")}`;
}

function ensureAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function createIntakeFormAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Untitled form";
  const type = String(formData.get("type") ?? "job_application").trim();
  const { membership, supabase } = await getActionContext();
  if (!ensureAdmin(membership.role)) return;

  await (supabase.from("intake_forms" as never).insert({
    organization_id: membership.organization_id,
    name,
    type,
    token: newToken(),
    active: true,
  } as never) as unknown as Promise<unknown>);

  revalidatePath("/app/settings/intake-forms", "page");
}

export async function regenerateIntakeTokenAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (!ensureAdmin(membership.role)) return;

  await (supabase
    .from("intake_forms" as never)
    .update({ token: newToken() } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  revalidatePath("/app/settings/intake-forms", "page");
}

export async function toggleIntakeFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (!ensureAdmin(membership.role)) return;

  await (supabase
    .from("intake_forms" as never)
    .update({ active: !active } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  revalidatePath("/app/settings/intake-forms", "page");
}

export async function deleteIntakeFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (!ensureAdmin(membership.role)) return;

  await (supabase
    .from("intake_forms" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);

  revalidatePath("/app/settings/intake-forms", "page");
}
