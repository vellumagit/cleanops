"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Star, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { updateReviewAction, deleteReviewAction } from "./actions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: {
    id: string;
    rating: number;
    comment: string | null;
    client_name: string;
  } | null;
};

export function ReviewEditDialog({ open, onOpenChange, review }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !review) return;
    setRating(review.rating);
    setComment(review.comment ?? "");
    setFormError(null);
  }, [open, review]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!review) return;
    const fd = new FormData();
    fd.set("id", review.id);
    fd.set("rating", String(rating));
    fd.set("comment", comment);
    startTransition(async () => {
      const res = await updateReviewAction(fd);
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      toast.success("Review updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!review) return;
    if (!confirm("Delete this review? This can't be undone.")) return;
    const fd = new FormData();
    fd.set("id", review.id);
    startTransition(async () => {
      try {
        await deleteReviewAction(fd);
        toast.success("Review deleted");
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit review</DialogTitle>
          <DialogDescription>
            {review
              ? `Adjust the rating or comment for ${review.client_name}'s review.`
              : "Adjust the rating or comment."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Rating</Label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className="rounded-md p-1 transition-colors hover:bg-muted"
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                >
                  <Star
                    className={cn(
                      "h-6 w-6",
                      n <= rating
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm tabular-nums text-muted-foreground">
                {rating.toFixed(1)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="comment">Comment</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Optional comment."
            />
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              disabled={pending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                <Pencil className="h-4 w-4" />
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
