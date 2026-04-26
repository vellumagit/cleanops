"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { submitReviewAction } from "./actions";

type Props = {
  token: string;
  /** "booking" = arrived via bookings.review_token (post-completion cron /
   *  portal link). "invoice" = arrived via invoices.review_token (invoice
   *  paid path — legacy / parallel). */
  source: "booking" | "invoice";
  /** The id of the booking or invoice that matched the token. */
  sourceId: string;
  orgName: string;
  brandColor: string;
  clientName: string | null;
  /** Org's Google Business Profile review link. When set + rating ≥ 4,
   *  show a "Share on Google" CTA after submission. */
  googleReviewUrl: string | null;
};

export function ReviewForm({
  token,
  source,
  sourceId,
  orgName,
  brandColor,
  clientName,
  googleReviewUrl,
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

        {rating >= 4 && googleReviewUrl && (
          <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-sm font-medium">
              Glad you had a great experience!
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Would you mind leaving a Google review too? It helps{" "}
              {orgName} reach more people.
            </p>
            <a
              href={googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <GoogleIcon />
              Leave a Google Review
            </a>
          </div>
        )}

        {rating >= 4 && !googleReviewUrl && (
          /* No Google URL configured — still warm but no dead link. */
          <p className="mt-4 text-xs text-muted-foreground">
            We really appreciate it. Have a great day!
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="sourceId" value={sourceId} />
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
        {isPending ? "Submitting…" : "Submit Review"}
      </Button>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84z" fill="#EA4335" />
    </svg>
  );
}
