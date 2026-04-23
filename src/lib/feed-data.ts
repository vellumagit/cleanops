import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentMembership } from "@/lib/auth";
import { memberDisplayName } from "@/lib/member-display";

export type FeedPost = {
  id: string;
  body: string;
  image_url: string | null;
  pinned: boolean;
  created_at: string;
  author_id: string;
  author_name: string;
  author_role: string;
  is_own: boolean;
};

/**
 * Fetch the feed posts for an organization, pinned first then newest first.
 */
export async function fetchFeedPosts(
  membership: CurrentMembership,
  limit = 50,
): Promise<FeedPost[]> {
  const supabase = await createSupabaseServerClient();

  // Defense in depth: RLS on feed_posts already scopes to the caller's
  // org, but mirror the pattern used in chat-data.ts so an RLS regression
  // can't silently leak cross-org posts.
  const { data, error } = await (supabase
    .from("feed_posts" as never)
    .select(
      `
        id,
        body,
        image_url,
        pinned,
        created_at,
        author_id,
        author:memberships!feed_posts_author_id_fkey (
          id,
          role,
          display_name,
          profile:profiles ( full_name )
        )
      `,
    )
    .eq("organization_id" as never, membership.organization_id as never)
    .order("pinned" as never, { ascending: false } as never)
    .order("created_at" as never, { ascending: false } as never)
    .limit(limit) as unknown as Promise<{
    data: Array<{
      id: string;
      body: string;
      image_url: string | null;
      pinned: boolean;
      created_at: string;
      author_id: string;
      author: {
        id: string;
        role: string;
        display_name: string | null;
        profile: { full_name: string } | null;
      } | null;
    }> | null;
    error: { message: string } | null;
  }>);

  if (error) {
    console.error("[feed] fetchFeedPosts failed:", error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    body: p.body,
    image_url: p.image_url,
    pinned: p.pinned,
    created_at: p.created_at,
    author_id: p.author_id,
    author_name: p.author ? memberDisplayName(p.author) : "Team",
    author_role: p.author?.role ?? "member",
    is_own: p.author_id === membership.id,
  }));
}
