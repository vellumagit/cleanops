"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Home, Images, Loader2, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { shrinkPhoto } from "@/lib/shrink-photo";
import {
  CLIENT_MEDIA_BUCKET,
  CLIENT_MEDIA_MAX_BYTES,
  clientMediaType,
  formatMediaSize,
} from "@/lib/client-media-rules";
import {
  deleteClientMediaAction,
  finishClientMediaUploadAction,
  prepareClientMediaUploadAction,
} from "@/lib/client-media-actions";
import type { ClientMediaItem } from "@/lib/client-media";

/**
 * Photos and videos of a client's home: what the client sent when they
 * asked for a quote, where the key is, the state the place was in. Lives on
 * the client, so every cleaner who goes there sees it. Not the job's
 * before/after photos, which are taken on site.
 *
 * `bookingId` set (a booking or job page): shows the client's items plus
 * this booking's, and lets a manager choose whether a new one stays with
 * the client or with just this booking.
 */
export function ClientMediaCard({
  clientId,
  bookingId,
  items,
  canManage,
}: {
  clientId: string;
  bookingId?: string;
  items: ClientMediaItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const photoRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const [caption, setCaption] = useState("");
  const [keepWithClient, setKeepWithClient] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  if (!canManage && items.length === 0) return null;

  async function uploadAll(files: File[]) {
    const supabase = createSupabaseBrowserClient();
    const attachTo = bookingId && !keepWithClient ? bookingId : null;
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
      const original = files[i];
      const isPhoto = (clientMediaType(original.type, original.name) ?? "").startsWith("image/");
      const file = isPhoto ? await shrinkPhoto(original) : original;
      const mime = clientMediaType(file.type, file.name);
      const label = files.length > 1 ? `${original.name}: ` : "";
      if (!mime) {
        toast.error(`${label}Only photos and videos (MP4, MOV, WebM) can be added.`);
        continue;
      }
      if (file.size > CLIENT_MEDIA_MAX_BYTES) {
        toast.error(`${label}${formatMediaSize(file.size)} is over the 50 MB limit. Send a shorter clip.`);
        continue;
      }
      try {
        const prep = await prepareClientMediaUploadAction({
          clientId,
          bookingId: attachTo,
          fileName: file.name,
          mimeType: mime,
          size: file.size,
        });
        if (!prep.ok) {
          toast.error(label + prep.error);
          continue;
        }
        // Straight to storage: the file never passes through our server,
        // so its size isn't bound by Vercel's 4.5 MB request cap.
        const { error: upErr } = await supabase.storage
          .from(CLIENT_MEDIA_BUCKET)
          .uploadToSignedUrl(prep.path, prep.token, file, { contentType: prep.mimeType });
        if (upErr) {
          toast.error(`${label}Upload failed: ${upErr.message}`);
          continue;
        }
        const fin = await finishClientMediaUploadAction({
          clientId,
          bookingId: attachTo,
          path: prep.path,
          mimeType: prep.mimeType,
          size: file.size,
          caption,
        });
        if (!fin.ok) {
          toast.error(label + fin.error);
          continue;
        }
        done++;
      } catch {
        toast.error(`${label}Upload failed. Check your connection and try again.`);
      }
    }
    setProgress(null);
    if (done > 0) {
      toast.success(done === 1 ? "Added" : `${done} added`);
      setCaption("");
      router.refresh();
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void uploadAll(files);
  }

  async function remove(id: string) {
    if (!confirm("Remove this from the client's record?")) return;
    setDeleting(id);
    const r = await deleteClientMediaAction(id).catch(() => ({ ok: false as const, error: "Couldn't remove it." }));
    setDeleting(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    router.refresh();
  }

  const busy = progress !== null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Home className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Home photos &amp; videos</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        What the home looks like, what the client sent for the quote, where the key is. Everyone on
        the team sees these.
      </p>

      {canManage && (
        <div className="mt-4 space-y-2">
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Note (optional), e.g. key is in the lockbox by the side door"
            maxLength={300}
            disabled={busy}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          {bookingId && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={keepWithClient}
                onChange={(e) => setKeepWithClient(e.target.checked)}
                disabled={busy}
              />
              Keep with the client, so every visit shows it (untick for this booking only)
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => photoRef.current?.click()}>
              <Camera className="h-4 w-4" />
              Take photo
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => videoRef.current?.click()}>
              <Video className="h-4 w-4" />
              Record video
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => galleryRef.current?.click()}>
              <Images className="h-4 w-4" />
              From gallery
            </Button>
          </div>
          {progress && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress}
            </p>
          )}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
          <input ref={videoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={onPick} />
          <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={onPick} />
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m) => (
            <figure key={m.id} className="group relative overflow-hidden rounded-lg border border-border bg-muted">
              {m.url == null ? (
                <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
                  Unavailable
                </div>
              ) : m.media_type === "video" ? (
                <video
                  src={m.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-square w-full bg-black object-contain"
                />
              ) : (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.caption ?? "Home photo"} loading="lazy" className="aspect-square w-full object-cover" />
                </a>
              )}
              {(m.caption || m.booking_id) && (
                <figcaption className="space-y-0.5 p-2 text-xs">
                  {m.caption && <p className="leading-snug">{m.caption}</p>}
                  {m.booking_id && !bookingId && (
                    <p className="text-muted-foreground">Attached to one booking</p>
                  )}
                </figcaption>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={deleting === m.id}
                  aria-label="Remove"
                  className="absolute right-1 top-1 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
                >
                  {deleting === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
