"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { can } from "@/lib/auth";
import { EstimateSchema } from "@/lib/validators/estimates";
import {
  autoBookingOnEstimateApproval,
  sendEstimateToClient,
} from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isRealPdf } from "@/lib/file-sniff";
import {
  ESTIMATE_PDF_MAX_BYTES,
  removeStoredEstimatePdf,
  storeEstimatePdf,
} from "@/lib/estimate-pdf-storage";
import { canCreateData } from "@/lib/subscription";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { normalizePhone } from "@/lib/phone";
import {
  estimateLinesHighTotalCents,
  estimateLinesTotalCents,
  highEnd,
  parseEstimateLines,
  type EstimateLine,
} from "@/lib/estimate-lines";

type Field = keyof typeof EstimateSchema.shape;
export type EstimateFormState = ActionState<Field | "pdf">;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    service_description: String(formData.get("service_description") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    status: String(formData.get("status") ?? "draft"),
    total_cents: String(formData.get("total_cents") ?? ""),
  };
}

/**
 * The form's lines. `present` is false for a caller that sent no lines field
 * at all, which must leave an estimate's lines alone rather than read as
 * "delete them". With lines, the total is their sum, whatever was typed.
 */
function readLines(formData: FormData, raw: { total_cents: string }) {
  if (!formData.has("line_items_json")) return { present: false, lines: [] as EstimateLine[] };
  const range = formData.get("price_range") === "on";
  const parsed = parseEstimateLines(formData.get("line_items_json"), { range });
  if (parsed.error) return { present: true, lines: [] as EstimateLine[], error: parsed.error };
  if (parsed.lines.length > 0) raw.total_cents = (estimateLinesTotalCents(parsed.lines) / 100).toFixed(2);
  return { present: true, lines: parsed.lines };
}

/**
 * The top of the estimate's price range, or null for a fixed price.
 *
 * - `touch` is false for a caller that sent no lines field: it knows
 *   nothing about ranges and must leave the saved one alone.
 * - With lines, it is what the lines' high prices add up to.
 * - With no lines, it is the typed "to" amount.
 */
function readHighTotal(
  formData: FormData,
  lineInput: { present: boolean; lines: EstimateLine[] },
  lowCents: number,
): { touch: boolean; cents: number | null; error?: string } {
  if (!lineInput.present) return { touch: false, cents: null };
  if (formData.get("price_range") !== "on") return { touch: true, cents: null };
  if (lineInput.lines.length > 0) return { touch: true, cents: estimateLinesHighTotalCents(lineInput.lines) };
  const text = String(formData.get("total_high_cents") ?? "").replace(/[$,\s]/g, "");
  if (text === "") return { touch: true, cents: null };
  const top = Number(text);
  if (!Number.isFinite(top) || top < 0 || top > 100_000_000) {
    return { touch: true, cents: null, error: "The high end of the range isn't a number." };
  }
  const cents = Math.round(top * 100);
  if (cents < lowCents) return { touch: true, cents: null, error: "The high end of the range is below the low end." };
  return { touch: true, cents: highEnd(lowCents, cents) };
}

function lineRows(orgId: string, estimateId: string, lines: EstimateLine[]) {
  return lines.map((l) => ({
    organization_id: orgId,
    estimate_id: estimateId,
    label: l.label,
    quantity: l.quantity,
    unit_price_cents: l.unit_price_cents,
    unit_price_high_cents: l.unit_price_high_cents,
    sort_order: l.sort_order,
  }));
}

function maybeStamp(status: string, prev?: { sent_at?: string | null; decided_at?: string | null }) {
  const now = new Date().toISOString();
  return {
    sent_at:
      status === "sent" || status === "approved" || status === "declined"
        ? prev?.sent_at ?? now
        : // Expired means it was sent and nobody answered; re-saving one must
          // not forget when it went out (the expiry cron counts from it).
          status === "expired"
          ? prev?.sent_at ?? null
          : null,
    decided_at:
      status === "approved" || status === "declined"
        ? prev?.decided_at ?? now
        : null,
  };
}

/**
 * "Someone new" on the estimate form: a quote for a person who isn't on the
 * books yet (asked for in person, 2026-11-19). They are added as a lead,
 * the same as someone who asked through the website, and the estimate goes
 * on that record.
 */
type NewPerson = { name: string; email: string | null; phone: string | null };

/** Stands in for client_id while the form is checked; never saved. */
const NEW_PERSON_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

function readNewPerson(formData: FormData): { person: NewPerson | null; error?: string; values: Record<string, string> } {
  const values = {
    who: String(formData.get("who") ?? ""),
    new_name: String(formData.get("new_name") ?? ""),
    new_email: String(formData.get("new_email") ?? ""),
    new_phone: String(formData.get("new_phone") ?? ""),
  };
  if (values.who !== "new") return { person: null, values };
  const name = values.new_name.trim();
  const email = values.new_email.trim();
  const phone = values.new_phone.trim();
  if (!name) return { person: null, values, error: "Type the person's name." };
  if (name.length > 200) return { person: null, values, error: "That name is too long." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { person: null, values, error: "That email address doesn't look right." };
  }
  return { person: { name, email: email || null, phone: phone ? normalizePhone(phone) : null }, values };
}

const ALLOWED_TYPES = ["application/pdf"];

/**
 * What's wrong with an uploaded PDF, or null. Checked BEFORE anything is
 * written: a create that saved the estimate and then refused the file sent
 * the person back to a form that, pressed again, made a second estimate.
 */
async function pdfProblem(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.includes(file.type)) return "Only PDF files are allowed.";
  if (file.size > ESTIMATE_PDF_MAX_BYTES) return "PDF must be under 10 MB.";
  // The label is the browser's word; the bytes are the file's.
  if (!(await isRealPdf(file))) return "That file isn't a PDF.";
  return null;
}

/**
 * Store an already-checked PDF in the private estimate-pdfs bucket
 * (lib/estimate-pdf-storage.ts). Returns the reference to save as pdf_url,
 * not a link: links are signed per viewer and expire.
 */
async function uploadEstimatePdf(
  orgId: string,
  estimateId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  const { ref, error } = await storeEstimatePdf(createSupabaseAdminClient(), orgId, estimateId, file);
  return { url: ref, error };
}

/**
 * Remove any existing PDF for an estimate from storage.
 */
async function removeEstimatePdf(orgId: string, estimateId: string) {
  await removeStoredEstimatePdf(createSupabaseAdminClient(), orgId, estimateId);
}

export async function createEstimateAction(
  _prev: EstimateFormState,
  formData: FormData,
): Promise<EstimateFormState> {
  const newPerson = readNewPerson(formData);
  const raw: ReturnType<typeof readFormValues> & Record<string, string> = {
    ...readFormValues(formData),
    ...newPerson.values,
  };
  if (newPerson.error) return { errors: { client_id: newPerson.error }, values: raw };
  const lineInput = readLines(formData, raw);
  if (lineInput.error) return { errors: { total_cents: lineInput.error }, values: raw };
  // For someone new there is no client yet; everything else is checked
  // first, and they are added only once the estimate is about to be saved.
  const parsed = parseForm(
    EstimateSchema,
    newPerson.person ? { ...raw, client_id: NEW_PERSON_PLACEHOLDER } : raw,
  );
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Estimates are money documents in a client's inbox. Page gates bounce the
  // wrong ROLES, but actions are callable directly — and nothing here checked
  // at all, so an employee-role member could create or send one. Same line
  // the invoice actions draw: owner/admin/manager, with the invoicing
  // capability.
  if (
    !["owner", "admin", "manager"].includes(membership.role) ||
    !can(membership, "invoicing")
  ) {
    return { errors: { _form: "Estimates aren't part of your access." }, values: raw };
  }

  if (!(await canCreateData(membership.organization_id))) {
    return { errors: { _form: "Your subscription has expired. Subscribe to create new estimates." }, values: raw };
  }

  const pdfFile = formData.get("pdf") as File | null;
  const newPdf = pdfFile && pdfFile.size > 0 ? pdfFile : null;
  if (newPdf) {
    const problem = await pdfProblem(newPdf);
    if (problem) return { errors: { pdf: problem }, values: raw };
  }

  const high = readHighTotal(formData, lineInput, parsed.data.total_cents);
  if (high.error) return { errors: { total_cents: high.error }, values: raw };

  // Someone new: find them, or add them as a lead. An email that matches a
  // person already on the books uses that person, so nobody is entered
  // twice. `addedPersonId` is set only when this save created the record,
  // so a save that fails further down can take it back out and pressing
  // Save again doesn't leave two of them.
  let clientId = parsed.data.client_id;
  let addedPersonId: string | null = null;
  if (newPerson.person) {
    const admin = createSupabaseAdminClient();
    const startedAt = Date.now();
    const found = await findOrCreateClient(
      admin,
      membership.organization_id,
      {
        name: newPerson.person.name,
        ...(newPerson.person.email ? { email: newPerson.person.email } : {}),
        ...(newPerson.person.phone ? { phone: newPerson.person.phone } : {}),
      },
      { createAs: "lead", leadSource: "other" },
    );
    if (!found) {
      return {
        errors: { client_id: "That person couldn't be added, so the estimate wasn't made. Check the email address, or add them on the Leads page first." },
        values: raw,
      };
    }
    clientId = found;
    const { data: row } = (await admin
      .from("clients")
      .select("created_at")
      .eq("id", found)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as { data: { created_at: string } | null };
    if (row && new Date(row.created_at).getTime() >= startedAt - 2_000) addedPersonId = found;
  }
  const undoNewPerson = async () => {
    if (!addedPersonId) return;
    await createSupabaseAdminClient()
      .from("clients")
      .delete()
      .eq("id", addedPersonId)
      .eq("organization_id", membership.organization_id);
  };

  const stamps = maybeStamp(parsed.data.status);
  const { data: estimate, error } = (await supabase
    .from("estimates")
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      service_description: parsed.data.service_description ?? null,
      notes: parsed.data.notes ?? null,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      total_high_cents: high.cents,
      sent_at: stamps.sent_at,
      decided_at: stamps.decided_at,
    } as never)
    .select("id")
    .single()) as unknown as { data: { id: string }; error: { message: string } | null };

  if (error) {
    await undoNewPerson();
    return { errors: { _form: error.message }, values: raw };
  }

  if (lineInput.lines.length > 0) {
    const { data: made, error: lineErr } = (await supabase
      .from("estimate_line_items")
      .insert(lineRows(membership.organization_id, estimate.id, lineInput.lines) as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (lineErr || (made?.length ?? 0) !== lineInput.lines.length) {
      // Lines and estimate are one thing to the person saving: an estimate
      // whose total has no lines behind it is worse than none.
      await supabase.from("estimates").delete().eq("id", estimate.id);
      await undoNewPerson();
      return { errors: { total_cents: "The line items couldn't be saved, so the estimate wasn't made. Try again." }, values: raw };
    }
  }

  if (newPdf) {
    const upload = await uploadEstimatePdf(
      membership.organization_id,
      estimate.id,
      newPdf,
    );
    if (upload.error || !upload.url) {
      // Storage failed after the row was made. Take the row back out, so the
      // form's error is the whole story and pressing Save again doesn't
      // leave two estimates behind.
      await supabase.from("estimates").delete().eq("id", estimate.id);
      await undoNewPerson();
      return { errors: { pdf: upload.error ?? "The PDF could not be stored. Try again." }, values: raw };
    }
    const { data: linked } = (await supabase
      .from("estimates" as never)
      .update({ pdf_url: upload.url } as never)
      .eq("id", estimate.id)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    if (!linked?.length) {
      await removeEstimatePdf(membership.organization_id, estimate.id);
      await supabase.from("estimates").delete().eq("id", estimate.id);
      await undoNewPerson();
      return { errors: { pdf: "The PDF could not be attached. Try again." }, values: raw };
    }
  }

  revalidatePath("/app/estimates");
  revalidatePath("/app");
  // To the estimate itself: that page is where it is sent, downloaded and
  // shared from, which is what comes next.
  redirect(`/app/estimates/${estimate.id}/edit`);
}

export async function updateEstimateAction(
  id: string,
  _prev: EstimateFormState,
  formData: FormData,
): Promise<EstimateFormState> {
  const raw = readFormValues(formData);
  const lineInput = readLines(formData, raw);
  if (lineInput.error) return { errors: { total_cents: lineInput.error }, values: raw };
  const parsed = parseForm(EstimateSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  if (
    !["owner", "admin", "manager"].includes(membership.role) ||
    !can(membership, "invoicing")
  ) {
    return { errors: { _form: "Estimates aren't part of your access." }, values: raw };
  }

  // Pull previous timestamps so we don't overwrite an earlier sent_at.
  const { data: prev } = await supabase
    .from("estimates")
    .select("sent_at, decided_at, status")
    .eq("id", id)
    .maybeSingle();

  const stamps = maybeStamp(parsed.data.status, prev ?? undefined);

  // PDF changes are checked now but made only once the row has saved. They
  // used to happen first: a save that then wrote nothing had already
  // replaced or deleted the stored file under an estimate still pointing
  // at it.
  const removePdf = formData.get("remove_pdf") === "1";
  const pdfFile = formData.get("pdf") as File | null;
  const newPdf = !removePdf && pdfFile && pdfFile.size > 0 ? pdfFile : null;
  if (newPdf) {
    const problem = await pdfProblem(newPdf);
    if (problem) return { errors: { pdf: problem }, values: raw };
  }

  const high = readHighTotal(formData, lineInput, parsed.data.total_cents);
  if (high.error) return { errors: { total_cents: high.error }, values: raw };

  const updatePayload: Record<string, unknown> = {
    client_id: parsed.data.client_id,
    service_description: parsed.data.service_description ?? null,
    notes: parsed.data.notes ?? null,
    status: parsed.data.status,
    total_cents: parsed.data.total_cents,
    ...(high.touch ? { total_high_cents: high.cents } : {}),
    sent_at: stamps.sent_at,
    decided_at: stamps.decided_at,
    ...(removePdf ? { pdf_url: null } : {}),
  };

  // Use the user's scoped client so RLS is enforced — never bypass it for
  // regular CRUD mutations (admin client is only for storage and webhooks).
  // .select() so a save that matched nothing says so: Postgres reports a
  // zero-row update as success, and this form used to redirect as if saved.
  const { data: saved, error } = (await supabase
    .from("estimates" as never)
    .update(updatePayload as never)
    .eq("id", id)
    .select("id")) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };

  if (error) return { errors: { _form: error.message }, values: raw };
  if (!saved?.length) {
    return {
      errors: {
        _form:
          "This estimate wasn't saved. It may have been deleted or archived, or your access doesn't allow changing it. Reload the page and check it.",
      },
      values: raw,
    };
  }

  // The lines, once the estimate itself has saved. New rows go in before
  // the old ones come out, so a failure leaves the old lines standing rather
  // than an estimate with a total and nothing behind it.
  if (lineInput.present) {
    let keep: string[] = [];
    if (lineInput.lines.length > 0) {
      const { data: made, error: lineErr } = (await supabase
        .from("estimate_line_items")
        .insert(lineRows(membership.organization_id, id, lineInput.lines) as never)
        .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };
      if (lineErr || (made?.length ?? 0) !== lineInput.lines.length) {
        if (made?.length) await supabase.from("estimate_line_items").delete().in("id", made.map((m) => m.id));
        return {
          errors: { total_cents: "Your other changes were saved, but the line items were not. Try saving again." },
          values: raw,
        };
      }
      keep = (made ?? []).map((m) => m.id);
    }
    let stale = supabase.from("estimate_line_items").delete().eq("estimate_id", id);
    if (keep.length) stale = stale.not("id", "in", `(${keep.join(",")})`);
    await stale;
  }

  if (removePdf) {
    await removeEstimatePdf(membership.organization_id, id);
  } else if (newPdf) {
    const upload = await uploadEstimatePdf(membership.organization_id, id, newPdf);
    if (upload.error || !upload.url) {
      return {
        errors: { pdf: `Your other changes were saved. ${upload.error ?? "The PDF could not be stored. Try again."}` },
        values: raw,
      };
    }
    await supabase
      .from("estimates" as never)
      .update({ pdf_url: upload.url } as never)
      .eq("id", id);
  }

  // Just approved: book the placeholder visit. Only on the change TO
  // approved, so tidying an approved estimate's notes doesn't bring back a
  // placeholder the office already deleted. In after(), not fired and
  // forgotten: the redirect ends the response, and Vercel can freeze the
  // function with the booking half-made.
  if (parsed.data.status === "approved" && prev?.status !== "approved") {
    after(() => autoBookingOnEstimateApproval(id));
  }

  revalidatePath("/app/estimates");
  revalidatePath(`/app/estimates/${id}/edit`);
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/estimates");
}

export type SendEstimateState = { ok?: boolean; error?: string };

/**
 * Send the estimate to the client as an email with a public-token link.
 * Generates the token on first send; subsequent sends reuse it.
 *
 * Owner-initiated → passes `manualSend: true` so the underlying
 * sendEstimateToClient bypasses the platform CLIENT_EMAILS_PAUSED kill
 * switch. The kill switch only applies to the cron-driven follow-up
 * (sendStaleEstimateFollowups).
 */
export async function sendEstimateAction(
  _prev: SendEstimateState,
  formData: FormData,
): Promise<SendEstimateState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing estimate id" };

  // Membership check — anyone who can view/edit estimates can send them.
  // The membership's org id also SCOPES the send: sendEstimateToClient uses
  // the service-role client, so without it any member of any org could
  // force-send another org's estimate by UUID (audit G2).
  const { membership } = await getActionContext();
  if (
    !["owner", "admin", "manager"].includes(membership.role) ||
    !can(membership, "invoicing")
  ) {
    return { error: "Estimates aren't part of your access." };
  }

  // manualSend:true tells the automation to bypass the platform
  // CLIENT_EMAILS_PAUSED kill switch — an owner clicking "Send" is
  // operational, not automated, and shouldn't be silently dropped.
  const result = await sendEstimateToClient(id, {
    manualSend: true,
    organizationId: membership.organization_id,
  });
  if (!result.ok) {
    return { error: result.error ?? "Could not send estimate" };
  }

  revalidatePath(`/app/estimates/${id}/edit`);
  revalidatePath("/app/estimates");
  return { ok: true };
}

/**
 * Owner-side helper: make sure the estimate has a public_token + expiry,
 * mint one if it doesn't, and return the resulting public URL so the
 * Download PDF button can navigate to /api/e/[token]/pdf without
 * needing the estimate to have been Sent first.
 *
 * Same mint logic as sendEstimateToClient — 30-day expiry, 16-char
 * unguessable token. Idempotent: subsequent calls just return the
 * existing token.
 */
export type EnsureTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export async function ensureEstimatePublicTokenAction(
  estimateId: string,
): Promise<EnsureTokenResult> {
  if (!estimateId) return { ok: false, error: "Missing estimate id" };

  const { membership } = await getActionContext();
  if (
    !["owner", "admin", "manager"].includes(membership.role) ||
    !can(membership, "invoicing")
  ) {
    return { ok: false, error: "Estimates aren't part of your access." };
  }

  // Admin client because the existing send path also writes via admin
  // (token mint isn't a user-driven column). We strictly scope to the
  // caller's org for safety.
  const admin = createSupabaseAdminClient();
  const { data: estimate } = (await admin
    .from("estimates")
    .select("id, public_token, expires_at, organization_id")
    .eq("id", estimateId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      public_token: string | null;
      expires_at: string | null;
      organization_id: string;
    } | null;
  };

  if (!estimate) {
    return { ok: false, error: "Estimate not found." };
  }

  if (estimate.public_token) {
    return { ok: true, token: estimate.public_token };
  }

  // Mint a new token + 30-day expiry. Use the same claim-token helper
  // the send path uses so format and entropy are identical.
  const { generateClaimToken } = await import("@/lib/claim-token");
  const token = generateClaimToken();
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await admin
    .from("estimates")
    .update({ public_token: token, expires_at: expiresAt } as never)
    .eq("id", estimateId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, token };
}

export async function deleteEstimateAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (
    !["owner", "admin", "manager"].includes(membership.role) ||
    !can(membership, "invoicing")
  ) {
    return;
  }

  // Row first, file second: the file goes only once the estimate has.
  const { data: deleted, error } = (await supabase
    .from("estimates")
    .delete()
    .eq("id", id)
    .select("id")) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };
  if (error) throw error;
  if (deleted?.length) {
    await removeEstimatePdf(membership.organization_id, id).catch(() => {});
  }
  revalidatePath("/app/estimates");
  redirect("/app/estimates");
}
