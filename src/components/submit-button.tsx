"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Props = {
  /** Default label when idle. */
  children: React.ReactNode;
  /** Label shown while the form is submitting. */
  pendingLabel?: string;
  /** Visual variant matching shadcn's Button. */
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  /** Optional name/value pair to disambiguate which submit was clicked. */
  name?: string;
  value?: string;
  /** Optionally override the form action (e.g. for delete buttons). */
  formAction?: string;
  /** Force-disable independent of pending state — use when the form's
   *  required preconditions aren't met (e.g. empty service catalog). */
  disabled?: boolean;
};

/**
 * Submit button that automatically disables itself and swaps its label
 * while the parent form is mid-submission. Reads from useFormStatus()
 * so callers don't need to thread `pending` through props.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
  name,
  value,
  formAction,
  disabled,
}: Props) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending || disabled}
      name={name}
      value={value}
      formAction={formAction}
      className={cn(className)}
    >
      {/* Additive: 74 of 75 call sites already pass pendingLabel, so the label
          swap stays. The spinner is for the one case a swapped label cannot
          cover — proving the work is still running rather than merely started.
          Kept out of the reduced-motion clamp on .animate-pulse deliberately:
          on a submit button the spin is the only continuous signal, and
          freezing it reads as a hang. */}
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
