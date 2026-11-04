"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import {
  CLIENT_MEDIA_BUCKET,
  CLIENT_MEDIA_MAX_BYTES,
  CLIENT_MEDIA_TYPES,
  clientMediaType,
} from "@/lib/client-media-rules";

/**
 * Home photos and videos on a client (client-media.ts). Managers add and
 * remove them; every member of the org can see them.
 *
 * An upload is three steps, because the file must not pass through us:
 * Vercel refuses a request body over 4.5 MB and a phone video is tens of
 * megabytes. (1) prepare checks the role, the client and the file and
 * returns a one-time signed upload URL; (2) the phone sends the file
 * straight to storage on it; (3) finish checks the file really landed and
 * records it.
 */

type Fail = { ok: false; error: string };

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

function revalidateFor(clientId: string, bookingId: string | null) {
  revalidatePath(`/app/clients/${clientId}`);
  if (bookingId) {
    revalidatePath(`/app/bookings/${bookingId}`);
    revalidatePath(`/field/jobs/${bookingId}`);
  }
}

/** The client (and optional booking) if both are in the caller's org. */
async function checkTarget(
  orgId: string,
  clientId: string,
  bookingId: string | null,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: client } = (await admin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", orgId)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (!client) return "Client not found.";
  if (bookingId) {
    const { data: booking } = (await admin
      .from("bookings")
      .select("id, client_id")
      .eq("id", bookingId)
      .eq("organization_id", orgId)
      .maybeSingle()) as unknown as { data: { id: string; client_id: string | null } | null };
    if (!booking || booking.client_id !== clientId) return "Booking not found.";
  }
  return null;
}

export async function prepareClientMediaUploadAction(input: {
  clientId: string;
  bookingId?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<{ ok: true; path: string; token: string; mimeType: string } | Fail> {
  const { membership } = await getActionContext();
  if (!canManage(membership.role)) {
    return { ok: false, error: "Only owners, admins and managers can add photos and videos here." };
  }
  const mime = clientMediaType(input.mimeType ?? "", input.fileName ?? "");
  if (!mime) return { ok: false, error: "Only photos (JPG, PNG, HEIC, WebP) and videos (MP4, MOV, WebM) can be added." };
  if (!(input.size > 0)) return { ok: false, error: "That file is empty." };
  if (input.size > CLIENT_MEDIA_MAX_BYTES) {
    return { ok: false, error: "Files must be under 50 MB. Trim the video or send a shorter clip." };
  }
  const bookingId = input.bookingId || null;
  const bad = await checkTarget(membership.organization_id, input.clientId, bookingId);
  if (bad) return { ok: false, error: bad };

  const ext =
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "video/3gpp": "3gp",
    }[mime] ?? "bin";
  const path = `${membership.organization_id}/${input.clientId}/${crypto.randomUUID()}.${ext}`;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(CLIENT_MEDIA_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[client-media] signed upload url failed:", error?.message);
    return { ok: false, error: "Couldn't start the upload. Try again." };
  }
  return { ok: true, path, token: data.token, mimeType: mime };
}

export async function finishClientMediaUploadAction(input: {
  clientId: string;
  bookingId?: string | null;
  path: string;
  mimeType: string;
  size: number;
  caption?: string | null;
}): Promise<{ ok: true } | Fail> {
  const { membership } = await getActionContext();
  if (!canManage(membership.role)) return { ok: false, error: "Not allowed." };

  // The path must be one prepare could have issued to this org and client.
  const prefix = `${membership.organization_id}/${input.clientId}/`;
  if (!input.path.startsWith(prefix) || input.path.includes("..")) {
    return { ok: false, error: "That upload doesn't belong here." };
  }
  const mediaType = CLIENT_MEDIA_TYPES[input.mimeType];
  if (!mediaType) return { ok: false, error: "Unsupported file type." };
  const bookingId = input.bookingId || null;
  const bad = await checkTarget(membership.organization_id, input.clientId, bookingId);
  if (bad) return { ok: false, error: bad };

  // Did the file actually arrive?
  const admin = createSupabaseAdminClient();
  const folder = prefix.slice(0, -1);
  const name = input.path.slice(prefix.length);
  const { data: listed } = await admin.storage
    .from(CLIENT_MEDIA_BUCKET)
    .list(folder, { search: name, limit: 1 });
  const obj = (listed ?? []).find((o) => o.name === name);
  if (!obj) return { ok: false, error: "The upload didn't finish. Try again." };
  const size =
    Number((obj.metadata as { size?: number } | null)?.size ?? input.size) || input.size;

  const caption = (input.caption ?? "").trim().slice(0, 300) || null;
  const { error } = (await (admin
    .from("client_media" as never)
    .insert({
      organization_id: membership.organization_id,
      client_id: input.clientId,
      booking_id: bookingId,
      storage_path: input.path,
      media_type: mediaType,
      mime_type: input.mimeType,
      size_bytes: size,
      caption,
      uploaded_by: membership.id,
    } as never) as unknown as Promise<{ error: { message: string } | null }>));
  if (error) {
    await admin.storage.from(CLIENT_MEDIA_BUCKET).remove([input.path]).catch(() => {});
    return { ok: false, error: error.message };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    entity_id: input.clientId,
    after: { home_media: mediaType, caption, booking_id: bookingId },
  });
  revalidateFor(input.clientId, bookingId);
  return { ok: true };
}

export async function deleteClientMediaAction(mediaId: string): Promise<{ ok: true } | Fail> {
  const { membership } = await getActionContext();
  if (!canManage(membership.role)) return { ok: false, error: "Not allowed." };

  const admin = createSupabaseAdminClient();
  const { data: row } = (await admin
    .from("client_media" as never)
    .select("id, organization_id, client_id, booking_id, storage_path, media_type, caption")
    .eq("id" as never, mediaId as never)
    .maybeSingle()) as unknown as {
    data: {
      organization_id: string;
      client_id: string;
      booking_id: string | null;
      storage_path: string;
      media_type: string;
      caption: string | null;
    } | null;
  };
  if (!row || row.organization_id !== membership.organization_id) {
    return { ok: false, error: "Not found." };
  }

  const { error } = (await (admin
    .from("client_media" as never)
    .delete()
    .eq("id" as never, mediaId as never) as unknown as Promise<{ error: { message: string } | null }>));
  if (error) return { ok: false, error: error.message };
  await admin.storage.from(CLIENT_MEDIA_BUCKET).remove([row.storage_path]).catch(() => {});

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "client",
    entity_id: row.client_id,
    before: { home_media: row.media_type, caption: row.caption },
  });
  revalidateFor(row.client_id, row.booking_id);
  return { ok: true };
}
