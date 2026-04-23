"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createManualEmployeeAction,
  type ManualEmployeeFormState,
} from "./actions";

const initialState: ManualEmployeeFormState = {};

/**
 * "Add manually" button + dialog. Creates a shadow employee — a membership
 * row without a profile link, so they can never log in. Useful for family
 * members, subs, or anyone who does the work but doesn't need app access.
 * They still appear as an assignable employee on bookings, timesheets,
 * payroll, and the like.
 */
export function AddManualEmployeeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createManualEmployeeAction,
    initialState,
  );

  // Close + refresh when the action reports done. We can't redirect from
  // inside the action because it'd fight with useActionState. The
  // setState-in-effect here is the idiomatic way to react to a returned
  // action state — suppressing the React 19 compiler warning.
  useEffect(() => {
    if (state.done) {
      toast.success("Employee added");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      router.refresh();
    }
  }, [state.done, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <UserPlus className="mr-2 h-4 w-4" />
            Add manually
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an employee manually</DialogTitle>
          <DialogDescription>
            For cleaners who won&rsquo;t use the app — a family member
            helping out, a sub, or anyone you just want on payroll. They
            can be assigned to jobs and show up on timesheets, but they
            can never log in.
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

          <div className="space-y-1.5">
            <Label htmlFor="display_name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="display_name"
              name="display_name"
              required
              autoComplete="name"
              defaultValue={state.values?.display_name}
              placeholder="e.g. Svitlana P."
              aria-invalid={Boolean(state.errors?.display_name)}
            />
            {state.errors?.display_name && (
              <p className="text-xs text-destructive">
                {state.errors.display_name}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select name="role" defaultValue={state.values?.role ?? "employee"}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Role only matters for permissions if you later send them an
              invite link. Shadow employees don&rsquo;t log in regardless.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay_rate">
                Pay rate{" "}
                <span className="font-normal text-muted-foreground">
                  ($/hr)
                </span>
              </Label>
              <Input
                id="pay_rate"
                name="pay_rate"
                inputMode="decimal"
                placeholder="22.00"
                defaultValue={state.values?.pay_rate}
                aria-invalid={Boolean(state.errors?.pay_rate)}
              />
              {state.errors?.pay_rate && (
                <p className="text-xs text-destructive">
                  {state.errors.pay_rate}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact_email">
              Email{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="contact_email"
              name="contact_email"
              type="email"
              autoComplete="email"
              defaultValue={state.values?.contact_email}
              placeholder="person@example.com"
              aria-invalid={Boolean(state.errors?.contact_email)}
            />
            {state.errors?.contact_email && (
              <p className="text-xs text-destructive">
                {state.errors.contact_email}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact_phone">
              Phone{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="contact_phone"
              name="contact_phone"
              type="tel"
              autoComplete="tel"
              defaultValue={state.values?.contact_phone}
              placeholder="+1 555 123 4567"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
