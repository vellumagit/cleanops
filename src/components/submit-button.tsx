"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
}: Props) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      name={name}
      value={value}
      formAction={formAction}
      className={cn(className)}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
