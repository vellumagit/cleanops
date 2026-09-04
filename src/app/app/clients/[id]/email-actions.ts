"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { can } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { sendOrgEmailDetailed, isEmailConfigured } from "@/lib/email";
import { isEmailSuppressed } from "@/lib/email-suppression";
import { clientMessageEmail } from "@/lib/email-templates";

/**
 * "Email client" — a hand-written message to a client, with the
 * paperwork from their record (or a fresh file) attached.
 *
 * Deliberate limits, because a manager account is the weakest link that
 * can reach this:
 *   - The recipient is always the client's address on record. There is
 *     no "to" field. Sending a client's signed paperwork to any other
 *     address means editing the client first, which is audited.
 *   - Attachments are either documents already on this client (verified
 *     org + client) or files uploaded right now under the same rules as
 *     the Documents card.
 *   - Everything sent is written to client_emails, win or lose, so the
 *     sent folder is the truth even when Resend said no.
 *
 * Shape: validate everything first, with no I/O that leaves state
 * behind; then do the storage work; then send. That order is what keeps
 * a refused send from leaving half-kept uploads on the record.
 */

const BUCKET = "client-documents";
/** Everything attached, existing documents included. Resend's ceiling is 40 MB. */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/**
 * Files added in the dialog travel inside the server-action request, and
 * Vercel caps that request at 4.5 MB before our code runs. Documents
 * already on the record are pulled from storage server-side and don't
 * count against this — that's the path for anything big.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};
function resolveMime(file: File): string | null {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

export type ClientEmailFormState = {
  error?: string;
  /** What the user typed, so an error doesn't blank the form. */
  values?: { subject: string; body: string };
  /** Set on success so the dialog can close itself. */
  sentAt?: number;
};

type AttachmentMeta = {
  name: string;
  size_bytes: number;
  document_id: string | null;
};

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

export async function sendClientEmailAction(
  clientId: string,
  _prev: ClientEmailFormState,
  formData: FormData,
): Promise<ClientEmailFormState> {
  const { membership } = await getActionContext();
  if (!canManage(membership.role) || !can(membership, "clients")) {
    return { error: "You don't have permission to email clients." };
  }
  if (!isEmailConfigured()) {
    return { error: "Email isn't configured for this workspace yet." };
  }

  const subject = String(formData.get("subject") ?? "")
    .trim()
    .slice(0, MAX_SUBJECT);
  const body = String(formData.get("body") ?? "")
    .trim()
    .slice(0, MAX_BODY);
  const values = { subject, body };
  const fail = (error: string): ClientEmailFormState => ({ error, values });

  if (!subject) return fail("Give the email a subject.");
  if (!body) return fail("Write something in the message.");

  const keepUploads = formData.get("keep_uploads") === "on";
  const documentIds = [
    ...new Set(
      formData
        .getAll("document_ids")
        .map((v) => String(v))
        .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
    ),
  ];
  const uploads = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const admin = createSupabaseAdminClient();

  // ── Validate: client ─────────────────────────────────────────────────
  // Must be in the caller's org, must have somewhere to send to. The
  // address on record is the only recipient.
  const { data: client } = (await admin
    .from("clients")
    .select("id, name, email, archived_at")
    .eq("id", clientId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      email: string | null;
      archived_at: string | null;
    } | null;
  };
  if (!client) return fail("Client not found.");
  if (client.archived_at) {
    return fail("This client is archived. Restore them to email them.");
  }
  const to = (client.email ?? "").trim().toLowerCase();
  if (!to) {
    return fail(
      "This client has no email address on record. Add one on their profile first.",
    );
  }
  if (await isEmailSuppressed(to)) {
    return fail(
      "That address bounced or unsubscribed earlier, so we can't send to it. Confirm the address with the client and update their profile.",
    );
  }

  // ── Validate: documents on the record ────────────────────────────────
  type DocRow = {
    id: string;
    file_name: string;
    file_path: string;
    mime_type: string | null;
    size_bytes: number | null;
  };
  let docs: DocRow[] = [];
  if (documentIds.length > 0) {
    const { data } = (await admin
      .from("client_documents" as never)
      .select("id, file_name, file_path, mime_type, size_bytes")
      .in("id" as never, documentIds as never)
      .eq("client_id" as never, clientId as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )) as unknown as { data: DocRow[] | null };
    docs = data ?? [];
    if (docs.length !== documentIds.length) {
      return fail("One of the selected documents isn't on this client.");
    }
  }

  // ── Validate: fresh uploads ──────────────────────────────────────────
  const uploadPlans: { file: File; mime: string }[] = [];
  let uploadBytes = 0;
  for (const file of uploads) {
    const mime = resolveMime(file);
    if (!mime || !ALLOWED_MIME.has(mime)) {
      return fail(`"${file.name}" isn't a PDF or image.`);
    }
    uploadBytes += file.size;
    uploadPlans.push({ file, mime });
  }
  if (uploadBytes > MAX_UPLOAD_BYTES) {
    return fail(
      "Files added here can total 4 MB. For anything bigger, upload it to the client's Documents first and tick it from the list.",
    );
  }
  const totalBytes =
    uploadBytes + docs.reduce((n, d) => n + (d.size_bytes ?? 0), 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return fail("Attachments add up to more than 20 MB. Send fewer at once.");
  }

  // ── Storage work ─────────────────────────────────────────────────────
  // Nothing below can be refused for a reason the user controls; any
  // failure is ours, and we clean up what we kept before reporting it.
  const attachments: { filename: string; content: Buffer; contentType?: string }[] =
    [];
  const meta: AttachmentMeta[] = [];
  const savedPaths: string[] = [];

  const rollback = async () => {
    if (savedPaths.length === 0) return;
    await admin.storage.from(BUCKET).remove(savedPaths).catch(() => {});
    await admin
      .from("client_documents" as never)
      .delete()
      .in("file_path" as never, savedPaths as never);
  };

  for (const d of docs) {
    const { data: blob, error } = await admin.storage
      .from(BUCKET)
      .download(d.file_path);
    if (error || !blob) {
      return fail(`Couldn't read "${d.file_name}" from storage.`);
    }
    const content = Buffer.from(await blob.arrayBuffer());
    attachments.push({
      filename: d.file_name,
      content,
      contentType: d.mime_type ?? undefined,
    });
    meta.push({
      name: d.file_name,
      size_bytes: content.byteLength,
      document_id: d.id,
    });
  }

  for (const { file, mime } of uploadPlans) {
    const content = Buffer.from(await file.arrayBuffer());
    attachments.push({ filename: file.name, content, contentType: mime });

    let documentId: string | null = null;
    if (keepUploads) {
      // Same rules and same shape as the Documents card upload, so the
      // file shows up there too — one place for everything sent.
      const safeName =
        file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
      const path = `${membership.organization_id}/${clientId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(path, content, { contentType: mime, upsert: false });
      if (upErr) {
        await rollback();
        return fail(`Couldn't keep "${file.name}" on the record: ${upErr.message}`);
      }
      savedPaths.push(path);
      const { data: row, error: insErr } = (await (admin
        .from("client_documents" as never)
        .insert({
          organization_id: membership.organization_id,
          client_id: clientId,
          category: "other",
          label: file.name,
          file_name: file.name,
          file_path: path,
          mime_type: mime,
          size_bytes: content.byteLength,
          uploaded_by: membership.id,
        } as never)
        .select("id")
        .maybeSingle() as unknown as Promise<{
        data: { id: string } | null;
        error: { message: string } | null;
      }>));
      if (insErr) {
        await rollback();
        return fail(`Couldn't keep "${file.name}" on the record: ${insErr.message}`);
      }
      documentId = row?.id ?? null;
    }
    meta.push({ name: file.name, size_bytes: content.byteLength, document_id: documentId });
  }

  // ── Render + send ────────────────────────────────────────────────────
  const { data: org } = (await admin
    .from("organizations")
    .select("name, brand_color, logo_url, contact_email, contact_phone")
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      contact_email: string | null;
      contact_phone: string | null;
    } | null;
  };

  const template = clientMessageEmail({
    clientName: client.name,
    subject,
    body,
    attachmentNames: meta.map((m) => m.name),
    orgName: org?.name ?? membership.organization_name,
    brandColor: org?.brand_color ?? undefined,
    logoUrl: org?.logo_url ?? undefined,
    contactEmail: org?.contact_email ?? null,
    contactPhone: org?.contact_phone ?? null,
  });

  // A human pressed Send. The platform pause is for cron-driven mail.
  const result = await sendOrgEmailDetailed(membership.organization_id, {
    to,
    toName: client.name,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments,
    pauseExempt: true,
  });

  const { error: logErr } = (await admin
    .from("client_emails" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      sent_by: membership.id,
      to_email: to,
      subject,
      body,
      attachments: meta,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.reason,
      provider_id: result.ok ? result.id : null,
    } as never)) as unknown as { error: { message: string } | null };
  if (logErr) {
    console.error("[client-email] sent folder insert failed:", logErr.message);
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    entity_id: clientId,
    after: {
      email: subject,
      to,
      attachments: meta.map((m) => m.name),
      status: result.ok ? "sent" : "failed",
    },
  });

  revalidatePath(`/app/clients/${clientId}`);

  if (!result.ok) {
    return fail(`Email didn't send: ${result.reason}`);
  }
  if (logErr) {
    // The email went. Say so, and say what didn't happen.
    return fail(
      "The email was sent, but it couldn't be added to Sent emails. Tell Sollos support so the record can be fixed.",
    );
  }
  return { sentAt: Date.now() };
}
