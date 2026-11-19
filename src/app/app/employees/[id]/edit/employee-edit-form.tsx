"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PayRateField } from "@/components/pay-rate-field";
import { UserCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { updateMemberAction, type UpdateMemberState } from "../../actions";
import {
  ENGAGEMENTS,
  ENGAGEMENT_LABEL,
  ENGAGEMENT_HELP,
  toEngagement,
  type Engagement,
} from "@/lib/engagement";
import {
  MANAGER_CAPABILITIES,
  hasCapability,
  type CapabilityMap,
} from "@/lib/capabilities";

const initial: UpdateMemberState = {};

export type EmployeeEditDefaults = {
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  accommodations: string | null;
  role: "owner" | "admin" | "manager" | "employee";
  engagement: string | null;
  pay_rate_cents: number | null;
  status: "active" | "invited" | "disabled";
  /** Why they were deactivated — admin-only, shown/edited only when disabled. */
  exit_reason: string | null;
  /** true when this member was added manually and has no login account. */
  is_shadow: boolean;
  /** What a manager may open. Null means nothing has been switched off. */
  capabilities: CapabilityMap;
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
  const [engagement, setEngagement] = useState<Engagement>(
    toEngagement(defaults.engagement),
  );
  // Controlled so the exit-reason field can follow the selection live.
  const [status, setStatus] = useState<"active" | "disabled">(
    defaults.status === "disabled" ? "disabled" : "active",
  );
  // Controlled so the access switches appear the moment Manager is picked,
  // not after a save and a reload.
  const [role, setRole] = useState(defaults.role);
  const boundAction = updateMemberAction.bind(null, memberId);
  const [state, formAction, pending] = useActionState(boundAction, initial);

  useEffect(() => {
    if (state.done && !pending) {
      toast.success(state.notice ?? "Employee updated", state.notice ? { duration: 12_000 } : undefined);
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
          {/*
            Deliberately NOT behind canChangeRole. Role is a permission and
            only an owner may change it; engagement decides which pay system
            someone is paid through, which is an admin's job too. Gating this
            on role would mean an admin could set someone's pay rate but not
            say how they get paid.
          */}
          <FormField label="Engagement" htmlFor="engagement">
            <FormSelect
              id="engagement"
              name="engagement"
              value={engagement}
              onChange={(e) => setEngagement(toEngagement(e.target.value))}
            >
              {ENGAGEMENTS.map((e) => (
                <option key={e} value={e}>
                  {ENGAGEMENT_LABEL[e]}
                </option>
              ))}
            </FormSelect>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {ENGAGEMENT_HELP[engagement]}
            </p>
          </FormField>

          {canChangeRole && (
            <FormField label="Role" htmlFor="role" error={state.errors?.role}>
              <FormSelect
                id="role"
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
              </FormSelect>
            </FormField>
          )}

          <PayRateField
            id="pay_rate"
            initialCents={defaults.pay_rate_cents}
            error={state.errors?.pay_rate}
          />

          {!isSelf && (
            <FormField label="Status" htmlFor="status" error={state.errors?.status}>
              <FormSelect
                id="status"
                name="status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value === "disabled" ? "disabled" : "active")
                }
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </FormSelect>
            </FormField>
          )}
        </div>

        {/* What THIS manager may open. Owners and admins always have
            everything and cleaners work from the phone app, so the switches
            only mean something for a manager. */}
        {canChangeRole && role === "manager" && (
          <fieldset
            id="manager-access"
            className="space-y-3 rounded-lg border border-border bg-muted/30 p-4"
          >
            <legend className="px-1 text-sm font-medium">Manager access</legend>
            <p className="text-xs text-muted-foreground">
              Untick anything that isn&rsquo;t this manager&rsquo;s job. An
              unticked area disappears from their menu and its pages turn them
              away. Everything stays on unless you untick it. Takes effect when
              you save.
            </p>
            {MANAGER_CAPABILITIES.map((cap) => (
              <label key={cap.key} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  name="capabilities"
                  value={cap.key}
                  defaultChecked={hasCapability("manager", defaults.capabilities, cap.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{cap.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {cap.description}
                  </span>
                </span>
              </label>
            ))}
            {/* Tells the save that this form owns the decision, so an
                unticked box is stored as "off" rather than read as absent. */}
            <input type="hidden" name="capabilities_present" value="1" />
          </fieldset>
        )}
        {canChangeRole && (role === "owner" || role === "admin") && (
          <p className="text-[11px] text-muted-foreground">
            Owners and admins can open everything. To limit what someone can
            open, make them a Manager and the access switches appear here.
          </p>
        )}

        {!isSelf && (
          <p className="text-[11px] text-muted-foreground">
            Disabled employees are hidden from assignment dropdowns and
            can&rsquo;t log in if they have an account.
          </p>
        )}

        {/* The exit record — only meaningful alongside Disabled. Admin-only
            storage (membership_admin_data), never visible to the employee. */}
        {!isSelf && status === "disabled" && (
          <FormField
            label="Reason for leaving (optional)"
            htmlFor="exit_reason"
            error={state.errors?.exit_reason}
          >
            <Textarea
              id="exit_reason"
              name="exit_reason"
              rows={2}
              placeholder="e.g. moved away, let go for no-shows, seasonal end…"
              defaultValue={defaults.exit_reason ?? ""}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Saved on their file, visible to owners and admins only. Cleared
              automatically if they&rsquo;re re-activated.
            </p>
          </FormField>
        )}
      </div>

      {/* ── Accommodations & health ──────────────────────────────────── */}
      <div className="space-y-4 border-t border-border pt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Accommodations &amp; health
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Allergies, sensitivities, accessibility needs, or medical
            considerations the team should know to keep this person safe and
            supported. Admin-only.
          </p>
        </div>

        <FormField
          label="Details"
          htmlFor="accommodations"
          error={state.errors?.accommodations}
        >
          <Textarea
            id="accommodations"
            name="accommodations"
            rows={3}
            placeholder="e.g. reacts to certain cleaning products, needs accessible entry, mobility considerations…"
            defaultValue={defaults.accommodations ?? ""}
          />
        </FormField>
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
