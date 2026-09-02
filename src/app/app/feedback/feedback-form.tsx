"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { FEEDBACK_KINDS, type FeedbackKind } from "@/lib/validators/feedback";
import { createFeedbackAction, type FeedbackItemFormState } from "./actions";

const empty: FeedbackItemFormState = {};

function isKind(v: string | undefined): v is FeedbackKind {
  return !!v && FEEDBACK_KINDS.some((k) => k.key === v);
}

/**
 * Three big tap targets instead of a dropdown. This form gets filled in one-
 * handed, on a phone, usually while something else is going wrong — a native
 * <select> costs a tap, a sheet, a scroll, and a confirm to say "it's broken".
 */
export function FeedbackForm({
  pageContext,
  defaultKind,
}: {
  pageContext: string | null;
  defaultKind?: string;
}) {
  const [state, formAction] = useActionState(createFeedbackAction, empty);
  const v = state.values as
    | { kind?: string; title?: string; body?: string }
    | undefined;

  const selected: FeedbackKind = isKind(v?.kind)
    ? v.kind
    : isKind(defaultKind)
      ? defaultKind
      : "bug";

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">What is it?</legend>
        <div className="grid gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <label
              key={k.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="kind"
                value={k.key}
                defaultChecked={selected === k.key}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {k.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {k.blurb}
                </span>
              </span>
            </label>
          ))}
        </div>
        {state.errors?.kind && (
          <p className="text-xs text-destructive">{state.errors.kind}</p>
        )}
      </fieldset>

      <FormField
        label="In one line"
        htmlFor="title"
        required
        error={state.errors?.title}
      >
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={v?.title ?? ""}
          placeholder="e.g. Invoice total is wrong on recurring jobs"
          autoComplete="off"
        />
      </FormField>

      <FormField
        label="Anything else"
        htmlFor="body"
        hint="What you expected, what happened instead, and which client or job it was on. Rough is fine."
        error={state.errors?.body}
      >
        <Textarea
          id="body"
          name="body"
          rows={5}
          maxLength={2000}
          defaultValue={v?.body ?? ""}
          placeholder="Optional — but the more of this, the fewer questions back."
        />
      </FormField>

      {/* Captured, not typed. Shown so nobody wonders what got sent. */}
      <input type="hidden" name="page_context" value={pageContext ?? ""} />
      <p className="text-xs text-muted-foreground">
        Sent with this report: the app version you&rsquo;re on and your device
        type
        {pageContext ? (
          <>
            , plus the page you came from (<code>{pageContext}</code>)
          </>
        ) : null}
        .
      </p>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/feedback"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
      </div>
    </form>
  );
}
