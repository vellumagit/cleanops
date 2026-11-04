import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberDisplayName } from "@/lib/member-display";
import { CLIENT_MEDIA_BUCKET } from "@/lib/client-media-rules";

export type ClientMediaItem = {
  id: string;
  media_type: "photo" | "video";
  mime_type: string;
  caption: string | null;
  booking_id: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  /** Short-lived signed URL (2 hours), or null if signing failed. */
  url: string | null;
};

/**
 * A client's home photos and videos, newest first.
 *
 * `bookingId` set: the client-wide items plus the ones attached to THAT
 * booking (what a booking page or a cleaner on the job should see).
 * Unset: everything for the client, including items attached to any of
 * their bookings (the client profile).
 *
 * Rows are read with the caller's own client, so RLS decides who sees them
 * (any active member of the org). URLs are signed with the service role
 * because the bucket has no read policy at all.
 */
export async function fetchClientMedia(
  clientId: string,
  opts: { bookingId?: string } = {},
): Promise<ClientMediaItem[]> {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("client_media" as never)
    .select(
      `id, media_type, mime_type, caption, booking_id, storage_path, created_at,
       uploader:memberships!client_media_uploaded_by_fkey ( display_name, profile:profiles ( full_name ) )`,
    )
    .eq("client_id" as never, clientId as never)
    .order("created_at" as never, { ascending: false })
    .limit(200);
  if (opts.bookingId) {
    q = q.or(`booking_id.is.null,booking_id.eq.${opts.bookingId}`);
  }
  const { data, error } = (await q) as unknown as {
    data: Array<{
      id: string;
      media_type: "photo" | "video";
      mime_type: string;
      caption: string | null;
      booking_id: string | null;
      storage_path: string;
      created_at: string;
      uploader: { display_name: string | null; profile: { full_name: string | null } | null } | null;
    }> | null;
    error: { message: string } | null;
  };
  if (error) {
    // The table arrives with migration 20261103010000; a page must still
    // render if this deploy reaches production before it has run.
    console.error("[client-media] fetch failed:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const admin = createSupabaseAdminClient();
  const { data: signed } = await admin.storage
    .from(CLIENT_MEDIA_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      60 * 60 * 2,
    );
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return rows.map((r) => ({
    id: r.id,
    media_type: r.media_type,
    mime_type: r.mime_type,
    caption: r.caption,
    booking_id: r.booking_id,
    uploaded_by_name: r.uploader ? memberDisplayName(r.uploader) : null,
    created_at: r.created_at,
    url: urlByPath.get(r.storage_path) ?? null,
  }));
}
