"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateMemberAction, type UpdateMemberState } from "./actions";

type Props = {
  member: {
    id: string;
    full_name: string;
    role: "owner" | "admin" | "manager" | "employee";
    status: "active" | "invited" | "disabled";
    pay_rate_cents: number | null;
    is_shadow: boolean;
    contact_email?: string | null;
    contact_phone?: string | null;
  };
  /** Role of the currently-signed-in user — only owners can change roles. */
  viewerRole: string;
  /** true when this row represents the signed-in user — hide deactivate. */
  isSelf: boolean;
};

const initialState: UpdateMemberState = {};

/**
 * Row-level edit dialog on /app/employees. Shows pay rate + role + status
 * for all members; additionally shows name + contact fields for shadow
 * (manually-added) members whose name isn't backed by a linked profile.
 */
export function EditEmployeeDialog({ member, viewerRole, isSelf }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const boundAction = updateMemberAction.bind(null, member.id);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState,
  );

  // Close + refresh when the action finishes a submit successfully.
  //
  // The `pending` dependency is the trick here. useActionState reuses the
  // same state object across successive submits — if the last result was
  // {done: true} and the next result is ALSO {done: true}, state.done
  // doesn't "change" and the effect wouldn't re-fire.
  //
  // With `pending` in the deps, the effect fires on every transition
  // (false → true at submit start, true → false at completion). We then
  // guard on `state.done && !pending` so we only act once per completed
  // submit — never on the kickoff, never on pending, only on the
  // successful finish.
  useEffect(() => {
    if (state.done && !pending) {
      toast.success("Saved");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      router.refresh();
    }
  }, [state.done, pending, router]);

  const canChangeRole = viewerRole === "owner";
  const canDeactivate = !isSelf;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Edit ${member.full_name}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {member.full_name}</DialogTitle>
          <DialogDescription>
            {member.is_shadow
              ? "Manually-added employee — update their name, contact info, role, or pay rate."
              : "Update role, pay rate, or deactivate this team member."}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {state.errors?._form && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {state.errors._form}
            </div>
          )}

          {/* Name / contact fields — shadow members only.
              Invited members' names flow from profiles.full_name; the
              employee edits those from their own profile page. */}
          {member.is_shadow && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`name-${member.id}`}>Name</Label>
                <Input
                  id={`name-${member.id}`}
                  name="display_name"
                  defaultValue={member.full_name}
                  required
                  aria-invalid={Boolean(state.errors?.display_name)}
                />
                {state.errors?.display_name && (
                  <p className="text-xs text-destructive">
                    {state.errors.display_name}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`email-${member.id}`}>
                    Email{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id={`email-${member.id}`}
                    name="contact_email"
                    type="email"
                    defaultValue={member.contact_email ?? ""}
                    aria-invalid={Boolean(state.errors?.contact_email)}
                  />
                  {state.errors?.contact_email && (
                    <p className="text-xs text-destructive">
                      {state.errors.contact_email}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`phone-${member.id}`}>
                    Phone{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id={`phone-${member.id}`}
                    name="contact_phone"
                    type="tel"
                    defaultValue={member.contact_phone ?? ""}
                  />
                </div>
              </div>
            </>
          )}

          {canChangeRole && (
            <div className="space-y-1.5">
              <Label htmlFor={`role-${member.id}`}>Role</Label>
              <Select name="role" defaultValue={member.role}>
                <SelectTrigger id={`role-${member.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                </SelectContent>
              </Select>
              {state.errors?.role && (
                <p className="text-xs text-destructive">
                  {state.errors.role}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`pay-${member.id}`}>
              Pay rate{" "}
              <span className="font-normal text-muted-foreground">
                ($/hr)
              </span>
            </Label>
            <Input
              id={`pay-${member.id}`}
              name="pay_rate"
              inputMode="decimal"
              placeholder="22.00"
              defaultValue={
                member.pay_rate_cents != null
                  ? (member.pay_rate_cents / 100).toFixed(2)
                  : ""
              }
            />
            {state.errors?.pay_rate && (
              <p className="text-xs text-destructive">
                {state.errors.pay_rate}
              </p>
            )}
          </div>

          {canDeactivate && (
            <div className="space-y-1.5">
              <Label htmlFor={`status-${member.id}`}>Status</Label>
              <Select
                name="status"
                defaultValue={
                  member.status === "disabled" ? "disabled" : "active"
                }
              >
                <SelectTrigger id={`status-${member.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Disabled members are hidden from assignment dropdowns and
                can&rsquo;t log in (if they ever had an account).
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
