import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { ComposeBox } from "@/components/feed/compose-box";
import { FeedCard } from "@/components/feed/feed-card";
import { fetchFeedPosts } from "@/lib/feed-data";

export const metadata = { title: "Feed" };

export default async function FieldFeedPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", membership.profile_id)
    .maybeSingle();

  const canPost = ["owner", "admin", "manager"].includes(membership.role);
  const posts = await fetchFeedPosts(membership);

  return (
    <>
      <FieldHeader
        title="Feed"
        description="Updates from your team."
      />

      <div className="space-y-4">
        {canPost && (
          <ComposeBox authorName={profile?.full_name ?? "You"} />
        )}

        {posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
            No updates from your team yet. Check back later.
          </div>
        ) : (
          posts.map((post) => (
            <FeedCard key={post.id} post={post} canManage={canPost} />
          ))
        )}
      </div>
    </>
  );
}
