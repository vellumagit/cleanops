"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ContractSchema } from "@/lib/validators/contracts";
import { sendOrgEmailDetailed, isClientEmailPaused } from "@/lib/email";
import { contractSignInvitationEmail } from "@/lib/email-templates";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents, humanizeEnum } from "@/lib/format";

type Field = keyof typeof ContractSchema.shape;
export type ContractFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    estimate_id: String(formData.get("estimate_id") ?? ""),
    service_type: String(formData.get("service_type") ?? "standard"),
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    agreed_price_cents: String(formData.get("agreed_price_cents") ?? ""),
    payment_terms: String(formData.get("payment_terms") ?? ""),
    status: String(formData.get("status") ?? "active"),
  };
}

export async function createContractAction(
  _prev: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ContractSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("contracts").insert({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    estimate_id: parsed.data.estimate_id,
    service_type: parsed.data.service_type,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    agreed_price_cents: parsed.data.agreed_price_cents,
    payment_terms: parsed.data.payment_terms ?? null,
    status: parsed.data.status,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/contracts");
  revalidatePath("/app");
  redirect("/app/contracts");
}

export async function updateContractAction(
  id: string,
  _prev: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ContractSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase
    .from("contracts")
    .update({
      client_id: parsed.data.client_id,
      estimate_id: parsed.data.estimate_id,
      service_type: parsed.data.service_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      agreed_price_cents: parsed.data.agreed_price_cents,
      payment_terms: parsed.data.payment_terms ?? null,
      status: parsed.data.status,
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/contracts");
  revalidatePath(`/app/contracts/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/contracts");
}

export async function deleteContractAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("contracts").delete().eq("id", id).eq("organization_id", membership.organization_id);
  if (error) throw error;
  revalidatePath("/app/contracts");
  redirect("/app/contracts");
}

// ---------------------------------------------------------------------------
// E-sign flow
// ---------------------------------------------------------------------------

export type SendContractState = {
  error?: string;
  ok?: boolean;
  /** Fully-qualified sign URL — safe to show/copy in the UI. */
  signUrl?: string;
  /** True when we successfully emailed the client. False/undefined means
   *  the link was minted but the owner still needs to share it manually
   *  (no client email, email paused, send failed). */
  emailed?: boolean;
  /** When emailed=false, why we skipped or failed — surfaced inline so
   *  the owner knows whether to copy the link. */
  emailNote?: string;
};

/**
 * Generate (or re-mint) a public sign link for a contract and flip its
 * sign_status to 'sent'. Idempotent for already-sent contracts: re-uses
 * the existing public_token so the link you shared with the client last
 * week still works. Stamps sent_at on first send.
 *
 * Uses the admin client for the UPDATE because contracts has no UPDATE
 * policy for the `sign_status` / token columns specifically — and we're
 * role-gating at the action layer anyway.
 */
export async function sendContractForSignatureAction(
  _prev: SendContractState,
  formData: FormData,
): Promise<SendContractState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing contract id." };

  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Only owners, admins, or managers can send contracts." };
  }

  const admin = createSupabaseAdminClient();

  const { data: existing } = (await admin
    .from("contracts")
    .select(
      `
        id, organization_id, public_token, sign_status,
        agreed_price_cents, service_type, start_date, end_date,
        client:clients ( id, name, email )
      `,
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      public_token: string | null;
      sign_status: string | null;
      agreed_price_cents: number;
      service_type: string;
      start_date: string;
      end_date: string | null;
      client: { id: string; name: string; email: string | null } | null;
    } | null;
  };

  if (!existing) return { error: "Contract not found." };
  if (existing.organization_id !== membership.organization_id) {
    return { error: "Contract not found." };
  }

  // Don't mint a new token on resend — the client's old link should
  // keep working. Only flip sent_at if this is the first send.
  const token =
    existing.public_token ??
    randomBytes(12).toString("base64url").slice(0, 16);

  const updates: Record<string, unknown> = {
    public_token: token,
    sign_status: existing.sign_status === "signed" ? "signed" : "sent",
  };
  if (!existing.public_token) {
    updates.sent_at = new Date().toISOString();
  }

  const { error } = await admin
    .from("contracts")
    .update(updates as never)
    .eq("id", id);

  if (error) {
    console.error("[contract-send] update failed:", error.message);
    return { error: error.message };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const signUrl = `${siteUrl}/c/${token}`;

  // Try to auto-email the client. If anything in the chain fails (no
  // email on file, paused at platform level, Resend reject), we still
  // return ok=true with the signUrl so the owner can copy-share — the
  // status flip and token are already persisted.
  const clientEmail = existing.client?.email ?? null;
  let emailed = false;
  let emailNote: string | undefined;

  if (!clientEmail) {
    emailNote = "Link generated. The client doesn't have an email on file — share it manually.";
  } else if (isClientEmailPaused()) {
    emailNote = "Link generated. Client emails are paused at the platform level — share it manually for now.";
  } else {
    try {
      const { data: orgData } = await admin
        .from("organizations")
        .select("name, brand_color, logo_url")
        .eq("id", membership.organization_id)
        .maybeSingle() as unknown as {
        data: {
          name: string;
          brand_color: string | null;
          logo_url: string | null;
        } | null;
      };

      const currency = await getOrgCurrency(membership.organization_id);

      const formatDateString = (iso: string) =>
        new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

      const template = contractSignInvitationEmail({
        clientName: existing.client?.name ?? "there",
        orgName: orgData?.name ?? "your cleaning team",
        serviceDescription: humanizeEnum(existing.service_type),
        amountFormatted: formatCurrencyCents(
          existing.agreed_price_cents,
          currency,
        ),
        startDate: formatDateString(existing.start_date),
        endDate: existing.end_date
          ? formatDateString(existing.end_date)
          : null,
        signUrl,
        brandColor: orgData?.brand_color ?? undefined,
        logoUrl: orgData?.logo_url ?? undefined,
      });

      const result = await sendOrgEmailDetailed(membership.organization_id, {
        to: clientEmail,
        toName: existing.client?.name ?? undefined,
        ...template,
      });

      if (result.ok) {
        emailed = true;
      } else {
        emailNote = `Link generated, but email to ${clientEmail} didn't go out: ${result.reason}. Share the link manually.`;
        console.warn(
          "[contract-send] email delivery failed:",
          result.reason,
        );
      }
    } catch (err) {
      // Don't fail the whole action — the link is the source of truth.
      console.error("[contract-send] email path threw:", err);
      emailNote =
        "Link generated, but the auto-email hit an unexpected error — share the link manually.";
    }
  }

  revalidatePath(`/app/contracts/${id}/edit`);
  revalidatePath("/app/contracts");
  return { ok: true, signUrl, emailed, emailNote };
}
