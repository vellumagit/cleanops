"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Send, X } from "lucide-react";
import { createFeedPostAction } from "@/lib/feed-actions";

/**
 * Compose box for creating feed posts — Instagram-style.
 * Text + optional image. Only visible to managers/admins.
 */
export function ComposeBox({ authorName }: { authorName: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit() {
    if (!body.trim() && !imageFile) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set("body", body.trim());
      if (imageFile) fd.set("image", imageFile);

      const result = await createFeedPostAction(fd);
      if (result.ok) {
        setBody("");
        removeImage();
        toast.success("Posted to feed");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const initial = (authorName ?? "U").slice(0, 1).toUpperCase();

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {initial}
        </div>

        {/* Input area */}
        <div className="min-w-0 flex-1">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share an update with your team…"
            rows={3}
            maxLength={5000}
            disabled={isPending}
            className="w-full resize-none rounded-lg border-0 bg-transparent p-0 text-[15px] placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {/* Image preview */}
          {imagePreview && (
            <div className="relative mt-2 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt="Upload preview"
                className="max-h-48 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={removeImage}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-md hover:bg-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Actions row */}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleImageChange}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <ImagePlus className="h-4 w-4" />
                Photo
              </button>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || (!body.trim() && !imageFile)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {isPending ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
