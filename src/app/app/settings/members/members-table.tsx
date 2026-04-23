"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";
import { Pencil } from "lucide-react";
import {
  updateMemberAction,
  type UpdateMemberState,
} from "../../employees/actions";

export type MemberRow = {
  id: string;
  profile_id: string | null;
  role: "owner" | "admin" | "manager" | "employee";
  status: "active" | "invited" | "disabled";
  pay_rate_cents: number | null;
  created_at: string;
  full_name: string;
  phone: string | null;
  is_self: boolean;
};

function statusTone(s: MemberRow["status"]): StatusTone {
  switch (s) {
    case "active":
      return "green";
    case "invited":
      return "amber";
    case "disabled":
      return "red";
  }
}

function roleTone(r: MemberRow["role"]): StatusTone {
  switch (r) {
    case "owner":
      return "blue";
    case "admin":
      return "blue";
    case "manager":
      return "amber";
    case "employee":
      return "neutral";
  }
}

function EditMemberDialog({
  member,
  currentRole,
}: {
  member: MemberRow;
  currentRole: string;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = updateMemberAction.bind(null, member.id);
  const [state, formAction, pending] = useActionState(
    boundAction,
    {} as UpdateMemberState,
  );

  // Close dialog on success
  if (state.done && open) {
    setOpen(false);
    window.location.reload();
  }

  const canChangeRole = currentRole === "owner";
  const canDeactivate = !member.is_self;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {member.full_name}</DialogTitle>
          <DialogDescription>
            Update role, pay rate, or deactivate this team member.
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
                <p className="text-xs text-destructive">{state.errors.role}</p>
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
              type="text"
              inputMode="decimal"
              placeholder="22.00"
              defaultValue={
                member.pay_rate_cents != null
                  ? (member.pay_rate_cents / 100).toFixed(2)
                  : ""
              }
            />
          </div>

          {canDeactivate && (
            <div className="space-y-1.5">
              <Label htmlFor={`status-${member.id}`}>Status</Label>
              <Select name="status" defaultValue={member.status === "disabled" ? "disabled" : "active"}>
                <SelectTrigger id={`status-${member.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Disabled members can&apos;t log in or access anything.
              </p>
            </div>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MembersTable({
  rows,
  currentRole,
}: {
  rows: MemberRow[];
  currentRole: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <p className="text-sm font-semibold text-foreground">
          No team members
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Go to Employees to invite your first team member.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {m.full_name}
                {m.is_self && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (you)
                  </span>
                )}
              </span>
              <StatusBadge tone={roleTone(m.role)}>
                {humanizeEnum(m.role)}
              </StatusBadge>
              <StatusBadge tone={statusTone(m.status)}>
                {humanizeEnum(m.status)}
              </StatusBadge>
            </div>
            <span className="text-xs text-muted-foreground">
              {m.phone ?? "No phone"} &middot; Joined{" "}
              {formatDate(m.created_at)}
              {m.pay_rate_cents != null && (
                <>
                  {" "}
                  &middot; {formatCurrencyCents(m.pay_rate_cents)}/hr
                </>
              )}
            </span>
          </div>

          <EditMemberDialog member={m} currentRole={currentRole} />
        </div>
      ))}
    </div>
  );
}
