"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ImagePlus, Images, Trash2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadJobPhotoAction, deleteJobPhotoAction } from "./photo-actions";
import type { JobPhoto } from "@/lib/job-photos";
import { shrinkPhoto, SERVER_ACTION_UPLOAD_LIMIT } from "@/lib/shrink-photo";

type OptimisticPhoto = {
  id: string; // local id while uploading
  preview: string; // blob: URL
  kind: "before" | "after" | "other";
  uploading: true;
};

type Props = {
  bookingId: string;
  photos: JobPhoto[];
  /** Whether the viewer is the assigned cleaner or a manager — if neither,
   *  the upload + delete UI is hidden (they can still view). */
  canManage: boolean;
};

export function JobPhotos({ bookingId, photos, canManage }: Props) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  // Which kind the next pick is for. A ref, not only state: the change event
  // fires after the picker closes and must read the kind chosen before it
  // opened, not whatever the last render captured.
  const kindRef = useRef<"before" | "after" | "other">("before");
  const [choosing, setChoosing] = useState<"before" | "after" | "other" | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticPhoto[]>([]);
  const [pending, startTransition] = useTransition();

  function choose(selectedKind: "before" | "after" | "other") {
    kindRef.current = selectedKind;
    setChoosing(selectedKind);
  }

  // Two pickers, because one can't serve both phones. The input used to
  // carry capture="environment": iPhone still offers "Photo Library" from
  // that, but Android opens the camera and nothing else, so a photo already
  // on the phone could never be added. The camera input keeps capture; the
  // gallery input has none and takes several at once.
  function openPicker(source: "camera" | "gallery") {
    setChoosing(null);
    (source === "camera" ? cameraInputRef : galleryInputRef).current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Clear the input so picking the same file twice in a row still fires.
    e.target.value = "";
    if (files.length === 0) return;
    const kind = kindRef.current;

    const queued = files.map((file) => ({
      file,
      opt: {
        id: crypto.randomUUID(),
        preview: URL.createObjectURL(file),
        kind,
        uploading: true as const,
      },
    }));
    setOptimistic((prev) => [...prev, ...queued.map((q) => q.opt)]);

    startTransition(async () => {
      let uploaded = 0;
      // One at a time: each is a server action body, and a phone on site
      // data shouldn't push several 8 MB photos at once.
      for (const { file: original, opt } of queued) {
        // Shrink first: the upload rides in a server action, which Vercel
        // caps at 4.5 MB, and Android cameras save photos bigger than that.
        const file = await shrinkPhoto(original);
        if (file.size > SERVER_ACTION_UPLOAD_LIMIT) {
          URL.revokeObjectURL(opt.preview);
          setOptimistic((prev) => prev.filter((p) => p.id !== opt.id));
          toast.error(
            `${original.name} is too large to upload from this phone. Try taking it again, or send a smaller copy.`,
          );
          continue;
        }
        const fd = new FormData();
        fd.set("booking_id", bookingId);
        fd.set("kind", kind);
        fd.set("photo", file);
        const result = await uploadJobPhotoAction(fd).catch(() => ({
          ok: false as const,
          error: "Upload failed. Check your connection and try again.",
        }));
        URL.revokeObjectURL(opt.preview);
        setOptimistic((prev) => prev.filter((p) => p.id !== opt.id));
        if (!result.ok) {
          toast.error(files.length > 1 ? `${original.name}: ${result.error}` : result.error);
          continue;
        }
        uploaded++;
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "Photo uploaded" : `${uploaded} photos uploaded`);
        router.refresh();
      }
    });
  }

  function handleDelete(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("photo_id", photoId);
      fd.set("booking_id", bookingId);
      const result = await deleteJobPhotoAction(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Photo deleted");
      router.refresh();
    });
  }

  const beforePhotos = photos.filter((p) => p.kind === "before");
  const afterPhotos = photos.filter((p) => p.kind === "after");
  const otherPhotos = photos.filter((p) => p.kind === "other");
  const optBefore = optimistic.filter((p) => p.kind === "before");
  const optAfter = optimistic.filter((p) => p.kind === "after");
  const optOther = optimistic.filter((p) => p.kind === "other");

  const hasAny = photos.length > 0 || optimistic.length > 0 || canManage;

  if (!hasAny) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Photos</h2>
        {canManage && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => choose("before")}
              disabled={pending}
            >
              <Camera className="h-4 w-4" />
              Before
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => choose("after")}
              disabled={pending}
            >
              <Camera className="h-4 w-4" />
              After
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => choose("other")}
              disabled={pending}
              aria-label="Add other photo"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {choosing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <span className="px-1 text-xs font-medium text-muted-foreground">
            {choosing === "before" ? "Before photo" : choosing === "after" ? "After photo" : "Other photo"}
          </span>
          <Button type="button" size="sm" onClick={() => openPicker("camera")}>
            <Camera className="h-4 w-4" />
            Take photo
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => openPicker("gallery")}>
            <Images className="h-4 w-4" />
            From gallery
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setChoosing(null)}
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* image/* rather than a list of types: Android hides gallery apps
          that don't advertise one of the listed types, and the server
          checks the real type from the file's bytes anyway. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {photos.length === 0 && optimistic.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {canManage
            ? "No photos yet. Tap Before or After above to take or add one."
            : "No photos yet."}
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          <PhotoGroup
            title="Before"
            photos={beforePhotos}
            optimistic={optBefore}
            canManage={canManage}
            onDelete={handleDelete}
          />
          <PhotoGroup
            title="After"
            photos={afterPhotos}
            optimistic={optAfter}
            canManage={canManage}
            onDelete={handleDelete}
          />
          {(otherPhotos.length > 0 || optOther.length > 0) && (
            <PhotoGroup
              title="Other"
              photos={otherPhotos}
              optimistic={optOther}
              canManage={canManage}
              onDelete={handleDelete}
            />
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function PhotoGroup({
  title,
  photos,
  optimistic,
  canManage,
  onDelete,
}: {
  title: string;
  photos: JobPhoto[];
  optimistic: OptimisticPhoto[];
  canManage: boolean;
  onDelete: (id: string) => void;
}) {
  if (photos.length === 0 && optimistic.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => (
          <PhotoTile
            key={p.id}
            src={p.signed_url}
            caption={p.caption}
            uploadedByName={p.uploaded_by_name}
            canDelete={canManage}
            onDelete={() => onDelete(p.id)}
          />
        ))}
        {optimistic.map((p) => (
          <div
            key={p.id}
            className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.preview}
              alt="Uploading"
              className="h-full w-full object-cover opacity-60"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-white drop-shadow" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoTile({
  src,
  caption,
  uploadedByName,
  canDelete,
  onDelete,
}: {
  src: string;
  caption: string | null;
  uploadedByName: string | null;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full w-full"
        title={caption ?? uploadedByName ?? undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption ?? "Job photo"}
          loading="lazy"
          className={cn(
            "h-full w-full object-cover transition-transform",
            "group-hover:scale-105",
          )}
        />
      </a>
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete photo"
          className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
