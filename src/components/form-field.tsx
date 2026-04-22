"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * FormField — label + control + error + hint, used by every CRUD form.
 *
 * Wrap any native input/select/textarea (or styled equivalent) so the label,
 * helper text, and field-level error message are all consistent.
 */
type Props = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: Props) {
  // Same stale-during-retry treatment as FormError — field-level messages
  // dim while a resubmission is in flight.
  const { pending } = useFormStatus();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p
          className={cn(
            "text-xs text-destructive transition-opacity",
            pending && "opacity-40",
          )}
        >
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Form-level error banner — for non-field errors (network, server,
 * permission denied, etc).
 *
 * While the enclosing form is submitting, the banner fades to let the
 * user know the old message is stale and a retry is in flight. If the
 * retry succeeds, the parent clears `message` and the banner unmounts
 * (with a CSS opacity transition). If it fails, the message stays /
 * changes and the banner snaps back to full opacity.
 */
export function FormError({ message }: { message?: string | null }) {
  const { pending } = useFormStatus();
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive transition-opacity",
        pending && "opacity-40",
      )}
    >
      {message}
    </div>
  );
}

/**
 * Native select element styled to match the Input component, so it can be
 * dropped into any FormField and submit naturally with FormData.
 */
export const FormSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function FormSelect({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
