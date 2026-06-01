import { notFound, redirect } from "next/navigation";
import { getCurrentMembership, requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { ComposeBox } from "@/components/feed/compose-box";
import { FeedCard } from "@/components/feed/feed-card";
import { fetchFeedPosts } from "@/lib/feed-data";
import { isFeedVisible } from "@/lib/feed-visibility";

export const metadata = { title: "Feed" };

export default async function AdminFeedPage() {
  // Check feed visibility BEFORE the MFA gate fires. Otherwise an
  // MFA-enrolled user hitting a bookmarked /app/feed for an org that
  // has feed_visible off gets prompted for their TOTP code just to
  // land on a 404 — silly UX. Cheap getCurrentMembership() call to
  // resolve the org id, then notFound() short-circuits everything.
  const initialMembership = await getCurrentMembership();
  if (!initialMembership) redirect("/login");
  if (!(await isFeedVisible(initialMembership.organization_id))) {
    notFound();
  }

  // Feed is on — enforce role + MFA via the standard gate. The double
  // membership-read is acceptable: the result is cached by the React
  // request cache in practice, and clarity > cleverness here.
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
    <PageShell
      title="Feed"
      description="Team announcements and updates."
    >
      <div className="mx-auto max-w-xl space-y-4">
        {canPost && (
          <ComposeBox authorName={profile?.full_name ?? "You"} />
        )}

        {posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-base text-muted-foreground">
            {canPost
              ? "No posts yet. Share the first update with your team!"
              : "No updates from your team yet. Check back later."}
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <FeedCard key={post.id} post={post} canManage={canPost} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
