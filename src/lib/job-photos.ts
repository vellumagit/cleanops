import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type JobPhoto = {
  id: string;
  booking_id: string;
  storage_path: string;
  signed_url: string;
  kind: "before" | "after" | "other";
  caption: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

/**
 * Fetch all photos for a booking along with short-lived signed URLs so
 * they can be rendered directly. 1-hour TTL is plenty for a page render.
 *
 * RLS on job_photos already scopes to the caller's org; we don't need an
 * extra .eq("organization_id", …) here.
 */
export async function fetchJobPhotos(bookingId: string): Promise<JobPhoto[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = (await supabase
    .from("job_photos" as never)
    .select(
      `
        id,
        booking_id,
        storage_path,
        kind,
        caption,
        uploaded_by,
        created_at,
        uploader:memberships!job_photos_uploaded_by_fkey (
          profile:profiles ( full_name )
        )
      `,
    )
    .eq("booking_id" as never, bookingId as never)
    .order("created_at" as never, { ascending: true } as never)) as unknown as {
    data: Array<{
      id: string;
      booking_id: string;
      storage_path: string;
      kind: "before" | "after" | "other";
      caption: string | null;
      uploaded_by: string | null;
      created_at: string;
      uploader: {
        profile: { full_name: string } | null;
      } | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error("[job-photos] fetch failed:", error.message);
    return [];
  }
  if (!data || data.length === 0) return [];

  // Batch-sign all URLs in one call.
  const paths = data.map((p) => p.storage_path);
  const { data: signed, error: signErr } = await supabase.storage
    .from("job-photos")
    .createSignedUrls(paths, 60 * 60); // 1 hour

  if (signErr) {
    console.error("[job-photos] sign batch failed:", signErr.message);
    return [];
  }

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }

  return data.map((p) => ({
    id: p.id,
    booking_id: p.booking_id,
    storage_path: p.storage_path,
    signed_url: urlByPath.get(p.storage_path) ?? "",
    kind: p.kind,
    caption: p.caption,
    uploaded_by: p.uploaded_by,
    uploaded_by_name: p.uploader?.profile?.full_name ?? null,
    created_at: p.created_at,
  }));
}
