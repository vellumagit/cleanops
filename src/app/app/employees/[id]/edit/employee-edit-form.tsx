"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { updateMemberAction, type UpdateMemberState } from "../../actions";

const initial: UpdateMemberState = {};

export type EmployeeEditDefaults = {
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  role: "owner" | "admin" | "manager" | "employee";
  pay_rate_cents: number | null;
  status: "active" | "invited" | "disabled";
  /** true when this member was added manually and has no login account. */
  is_shadow: boolean;
};

export function EmployeeEditForm({
  memberId,
  defaults,
  viewerRole,
  isSelf,
}: {
  memberId: string;
  defaults: EmployeeEditDefaults;
  /** Role of the currently-signed-in viewer — only owners can change roles. */
  viewerRole: "owner" | "admin" | "manager" | "employee";
  /** true when editing your own account — hides status toggle. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const boundAction = updateMemberAction.bind(null, memberId);
  const [state, formAction, pending] = useActionState(boundAction, initial);

  useEffect(() => {
    if (state.done && !pending) {
      toast.success("Employee updated");
      router.refresh();
    }
  }, [state.done, pending, router]);

  const canChangeRole = viewerRole === "owner";

  return (
    <form action={formAction} className="space-y-6">
      <FormError message={state.errors?._form} />

      {/* ── Personal information ───────────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Personal information
        </p>

        {!defaults.is_shadow && (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
            <UserCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40" />
            <span>
              This employee has a CleanOps account. Changing their name here
              updates how they appear across the app but does{" "}
              <strong>not</strong> change their login email.
            </span>
          </div>
        )}

        <FormField label="Full name" htmlFor="display_name" required error={state.errors?.display_name}>
          <Input
            id="display_name"
            name="display_name"
            required
            defaultValue={defaults.display_name}
            autoComplete="off"
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Phone" htmlFor="contact_phone" error={state.errors?.contact_phone}>
            <Input
              id="contact_phone"
              name="contact_phone"
              type="tel"
              defaultValue={defaults.contact_phone ?? ""}
              placeholder="+1 (555) 000-0000"
            />
          </FormField>

          <FormField
            label="Contact email"
            htmlFor="contact_email"
            error={state.errors?.contact_email}
          >
            <Input
              id="contact_email"
              name="contact_email"
              type="email"
              defaultValue={defaults.contact_email ?? ""}
              placeholder="for notifications / HR only"
            />
          </FormField>
        </div>

        <FormField label="Address" htmlFor="address" error={state.errors?.address}>
          <Input
            id="address"
            name="address"
            defaultValue={defaults.address ?? ""}
            placeholder="123 Main St, City, Province, Postal Code"
          />
        </FormField>
      </div>

      {/* ── Employment ────────────────────────────────────────────────── */}
      <div className="space-y-4 border-t border-border pt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Employment
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {canChangeRole && (
            <FormField label="Role" htmlFor="role" error={state.errors?.role}>
              <FormSelect id="role" name="role" defaultValue={defaults.role}>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
              </FormSelect>
            </FormField>
          )}

          <FormField
            label="Pay rate ($/hr)"
            htmlFor="pay_rate"
            error={state.errors?.pay_rate}
          >
            <Input
              id="pay_rate"
              name="pay_rate"
              inputMode="decimal"
              placeholder="22.00"
              defaultValue={
                defaults.pay_rate_cents != null
                  ? (defaults.pay_rate_cents / 100).toFixed(2)
                  : ""
              }
            />
          </FormField>

          {!isSelf && (
            <FormField label="Status" htmlFor="status" error={state.errors?.status}>
              <FormSelect
                id="status"
                name="status"
                defaultValue={
                  defaults.status === "disabled" ? "disabled" : "active"
                }
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </FormSelect>
            </FormField>
          )}
        </div>

        {!isSelf && (
          <p className="text-[11px] text-muted-foreground">
            Disabled employees are hidden from assignment dropdowns and
            can&rsquo;t log in if they have an account.
          </p>
        )}
      </div>

      {/* ── Internal notes ───────────────────────────────────────────── */}
      <div className="space-y-4 border-t border-border pt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Internal notes
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Only visible to admins — not shown to the employee.
          </p>
        </div>

        <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="Emergency contact, uniform size, start date, performance notes…"
            defaultValue={defaults.notes ?? ""}
          />
        </FormField>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <SubmitButton pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}
