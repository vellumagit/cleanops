"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Pin, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteFeedPostAction, togglePinPostAction } from "@/lib/feed-actions";
import type { FeedPost } from "@/lib/feed-data";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function roleBadge(role: string) {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "manager":
      return "Manager";
    default:
      return null;
  }
}

/**
 * Single feed post card — social-media style.
 */
export function FeedCard({
  post,
  canManage,
}: {
  post: FeedPost;
  canManage: boolean;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const initial = (post.author_name ?? "?").slice(0, 1).toUpperCase();
  const badge = roleBadge(post.author_role);

  function handleDelete() {
    if (!confirm("Delete this post? This can't be undone.")) return;
    const fd = new FormData();
    fd.set("post_id", post.id);
    startTransition(async () => {
      const result = await deleteFeedPostAction(fd);
      if (result.ok) {
        toast.success("Post deleted");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
    setMenuOpen(false);
  }

  function handleTogglePin() {
    const fd = new FormData();
    fd.set("post_id", post.id);
    fd.set("pinned", String(!post.pinned));
    startTransition(async () => {
      const result = await togglePinPostAction(fd);
      if (result.ok) {
        toast.success(post.pinned ? "Unpinned" : "Pinned to top");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
    setMenuOpen(false);
  }

  return (
    <article className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">
              {post.author_name}
            </span>
            {badge && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {badge}
              </span>
            )}
            {post.pinned && (
              <Pin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {timeAgo(post.created_at)}
          </span>
        </div>

        {/* Actions menu — for post author or admin */}
        {(post.is_own || canManage) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <>
                {/* Click-away */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg">
                  {canManage && (
                    <button
                      type="button"
                      onClick={handleTogglePin}
                      disabled={isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Pin className="h-4 w-4" />
                      {post.pinned ? "Unpin" : "Pin to top"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-muted disabled:opacity-50 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pb-3">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed break-words">
          {post.body}
        </p>
      </div>

      {/* Image */}
      {post.image_url && (
        <div className="border-t border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.image_url}
            alt="Post image"
            className="w-full object-cover"
            style={{ maxHeight: "480px" }}
          />
        </div>
      )}
    </article>
  );
}
