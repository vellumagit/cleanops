"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { hireApplicantAction, type HireFormState } from "../actions";

const empty: HireFormState = {};

/**
 * The yes, as one button. Everything the application already told us
 * prefills the invite; the owner adds the two things only they know —
 * engagement and wage — and the system does the rest: invite email,
 * membership with the wage applied at accept, onboarding training
 * auto-assigned, applicant stamped hired.
 */
export function HireDialog({
  applicantId,
  name,
  email,
}: {
  applicantId: string;
  name: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    hireApplicantAction.bind(null, applicantId),
    empty,
  );
  const [copied, setCopied] = useState(false);
  const refreshed = useRef(false);

  // One refresh once the hire lands, so the stage chip flips to Hired
  // behind the open dialog.
  useEffect(() => {
    if (state.hired && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [state.hired, router]);

  const inviteUrl = state.hired
    ? `${typeof window !== "undefined" ? window.location.origin : "https://sollos3.com"}/signup?invite=${state.hired.token}`
    : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied — the input below stays selectable.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <UserPlus className="h-4 w-4" />
        Hire {name?.split(" ")[0] ?? "them"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Hire {name ?? "this applicant"}
            </DialogTitle>
            <DialogDescription>
              Sends their team invite. When they accept, their account, wage,
              and onboarding training are all set up — nothing to remember.
            </DialogDescription>
          </DialogHeader>

          {state.hired ? (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                <p className="font-semibold">
                  Hired — invite {state.hired.emailSent ? "emailed to" : "created for"}{" "}
                  {state.hired.email}.
                </p>
                <p className="mt-1 text-[13px]">
                  {state.hired.emailSent
                    ? "They set a password from the email and land on the team with wage and training already in place."
                    : `The email did not go out (${state.hired.emailError ?? "unknown error"}) — send them the link below instead.`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteUrl} className="text-xs" />
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form action={action} className="mt-1 space-y-4">
              {state.errors?._form && (
                <p className="text-xs font-medium text-destructive">
                  {state.errors._form}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="hire-name">Name</Label>
                <Input
                  id="hire-name"
                  name="name"
                  required
                  defaultValue={name ?? ""}
                  maxLength={100}
                />
                {state.errors?.name && (
                  <p className="text-xs text-destructive">{state.errors.name}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hire-email">Email</Label>
                <Input
                  id="hire-email"
                  name="email"
                  type="email"
                  required
                  defaultValue={email ?? ""}
                />
                {state.errors?.email && (
                  <p className="text-xs text-destructive">
                    {state.errors.email}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="hire-engagement">Paid as</Label>
                  <FormSelect id="hire-engagement" name="engagement" defaultValue="employee">
                    <option value="employee">Employee (payroll)</option>
                    <option value="subcontractor">
                      Subcontractor (statements)
                    </option>
                  </FormSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hire-pay">Hourly wage</Label>
                  <Input
                    id="hire-pay"
                    name="pay_rate"
                    inputMode="decimal"
                    placeholder="e.g. 21.00"
                  />
                  {state.errors?.pay_rate && (
                    <p className="text-xs text-destructive">
                      {state.errors.pay_rate}
                    </p>
                  )}
                </div>
              </div>
              {/* Role is deliberately not asked: a hire from the applicant
                  pipeline is field staff. Promote later from Employees. */}
              <input type="hidden" name="role" value="employee" />
              <p className="text-[11px] text-muted-foreground">
                Published training marked &ldquo;assign to every new hire&rdquo;
                lands on their list the moment they join. Wage can be left
                blank and set later on their profile.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  disabled={pending}
                >
                  Cancel
                </button>
                <SubmitButton pendingLabel="Hiring…">
                  Send invite &amp; mark hired
                </SubmitButton>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
