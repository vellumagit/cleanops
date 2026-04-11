"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { submitReviewAction } from "./actions";

type Props = {
  token: string;
  invoiceId: string;
  orgName: string;
  brandColor: string;
  clientName: string | null;
};

export function ReviewForm({
  token,
  invoiceId,
  orgName,
  brandColor,
  clientName,
}: Props) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);

  const [state, formAction, isPending] = useActionState(
    submitReviewAction,
    { success: false, error: null as string | null },
  );

  if (state.success) {
    return (
      <div className="mt-6 text-center">
        <div className="mx-auto mb-3 flex w-max gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <span
              key={s}
              className={`text-2xl ${s <= rating ? "text-amber-400" : "text-muted-foreground/20"}`}
            >
              ★
            </span>
          ))}
        </div>
        <h2 className="text-lg font-bold">Thank you!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your feedback means a lot to {orgName}.
        </p>

        {rating >= 4 && (
          <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-sm font-medium">
              Glad you had a great experience!
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Would you mind leaving a Google review too? It helps {orgName}{" "}
              reach more people.
            </p>
            <a
              href={`https://search.google.com/local/writereview?placeid=`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Leave a Google Review
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="rating" value={rating} />

      {/* Star rating */}
      <div>
        <label className="block text-center text-sm font-medium text-muted-foreground">
          Rate your experience
        </label>
        <div className="mt-2 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(0)}
              className="rounded p-1 text-3xl transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2"
              style={{
                color:
                  star <= (hoveredStar || rating) ? "#f59e0b" : "#d1d5db",
                focusRingColor: brandColor,
              } as React.CSSProperties}
              aria-label={`${star} star${star !== 1 ? "s" : ""}`}
            >
              ★
            </button>
          ))}
        </div>
        {rating === 0 && state.error?.includes("rating") && (
          <p className="mt-1 text-center text-xs text-red-500">
            Please select a rating
          </p>
        )}
      </div>

      {/* Comment */}
      <div>
        <label
          htmlFor="comment"
          className="block text-sm font-medium text-muted-foreground"
        >
          Comments{" "}
          <span className="text-xs text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          id="comment"
          name="comment"
          rows={3}
          placeholder={`What did you like about the service${clientName ? `, ${clientName}` : ""}?`}
          className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-transparent focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": brandColor } as React.CSSProperties}
        />
      </div>

      {state.error && !state.error.includes("rating") && (
        <p className="text-center text-sm text-red-500">{state.error}</p>
      )}

      <Button
        type="submit"
        disabled={isPending || rating === 0}
        className="w-full"
        style={{ backgroundColor: brandColor }}
      >
        {isPending ? "Submitting..." : "Submit Review"}
      </Button>
    </form>
  );
}
