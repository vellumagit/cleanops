"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ImagePlus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  uploadJobPhotoAction,
  deleteJobPhotoAction,
} from "./photo-actions";
import type { JobPhoto } from "@/lib/job-photos";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<"before" | "after" | "other">("before");
  const [optimistic, setOptimistic] = useState<OptimisticPhoto[]>([]);
  const [pending, startTransition] = useTransition();

  function triggerFilePicker(selectedKind: "before" | "after" | "other") {
    setKind(selectedKind);
    // Defer so React commits the kind update before the picker opens — the
    // click handler on the hidden input reads state via the submission flow.
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    // Clear the input so picking the same file twice in a row still fires.
    e.target.value = "";

    const tempId = crypto.randomUUID();
    const preview = URL.createObjectURL(file);
    const opt: OptimisticPhoto = {
      id: tempId,
      preview,
      kind,
      uploading: true,
    };
    setOptimistic((prev) => [...prev, opt]);

    startTransition(async () => {
      const fd = new FormData();
      fd.set("booking_id", bookingId);
      fd.set("kind", kind);
      fd.set("photo", file);
      const result = await uploadJobPhotoAction(fd);

      // Always clean up the blob URL and remove the optimistic card —
      // the server refresh below will show the real row.
      URL.revokeObjectURL(preview);
      setOptimistic((prev) => prev.filter((p) => p.id !== tempId));

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Photo uploaded");
      router.refresh();
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

  const hasAny =
    photos.length > 0 || optimistic.length > 0 || canManage;

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
              onClick={() => triggerFilePicker("before")}
              disabled={pending}
            >
              <Camera className="h-4 w-4" />
              Before
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => triggerFilePicker("after")}
              disabled={pending}
            >
              <Camera className="h-4 w-4" />
              After
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => triggerFilePicker("other")}
              disabled={pending}
              aria-label="Add other photo"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Hidden file input — `capture="environment"` opens the rear camera
          on most mobile browsers but still allows a photo library pick. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {photos.length === 0 && optimistic.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {canManage
            ? "No photos yet. Tap Before or After above to capture one."
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
