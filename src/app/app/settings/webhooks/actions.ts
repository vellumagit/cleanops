"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function createWebhookAction(formData: FormData): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const events = formData.getAll("events").map(String).filter(Boolean);

  if (!name || !url.startsWith("https://") || events.length === 0) return;

  const admin = createSupabaseAdminClient();
  await admin
    .from("webhooks" as never)
    .insert({
      organization_id: membership.organization_id,
      name,
      url,
      events,
      created_by: membership.id,
    } as never);

  revalidatePath("/app/settings/webhooks", "page");
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const admin = createSupabaseAdminClient();
  await admin
    .from("webhooks" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never);

  revalidatePath("/app/settings/webhooks", "page");
}

export async function toggleWebhookAction(formData: FormData): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const id = String(formData.get("id") ?? "");
  const is_active = formData.get("is_active") === "true";
  if (!id) return;

  const admin = createSupabaseAdminClient();
  await admin
    .from("webhooks" as never)
    .update({ is_active } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never);

  revalidatePath("/app/settings/webhooks", "page");
}
