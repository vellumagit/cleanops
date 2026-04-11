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
import { UserPlus, Copy, Check } from "lucide-react";
import { sendInvitationAction, type InviteFormState } from "./actions";

const initialState: InviteFormState = {};

export function InviteDialog({ siteUrl }: { siteUrl: string }) {
  const [state, formAction, pending] = useActionState(
    sendInvitationAction,
    initialState,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const token = state.values?._token;
  const inviteLink = token ? `${siteUrl}/join/${token}` : null;

  function handleCopy() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // If invitation was just created, show the link
  if (inviteLink && !state.errors) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button size="sm">
              <UserPlus className="mr-2 h-4 w-4" />
              Invite
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation sent</DialogTitle>
            <DialogDescription>
              Share this link with{" "}
              <span className="font-medium text-foreground">
                {state.values?.email}
              </span>
              . They&apos;ll create an account and join your team.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={inviteLink}
                className="font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              This link expires in 14 days. You can revoke it from the
              employees list.
            </p>

            <Button
              className="w-full"
              onClick={() => {
                setOpen(false);
                window.location.reload();
              }}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Send an invitation link. They&apos;ll create an account and
            automatically join your organization.
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
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder="cleaner@example.com"
              autoComplete="email"
              required
              defaultValue={state.values?.email}
              aria-invalid={Boolean(state.errors?.email)}
            />
            {state.errors?.email && (
              <p className="text-xs text-destructive">{state.errors.email}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select name="role" defaultValue="employee">
              <SelectTrigger id="invite-role">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {state.errors?.role && (
              <p className="text-xs text-destructive">{state.errors.role}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Employees see the field app. Admins see the full ops console.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-pay-rate">
              Pay rate{" "}
              <span className="font-normal text-muted-foreground">
                (optional, $/hr)
              </span>
            </Label>
            <Input
              id="invite-pay-rate"
              name="pay_rate"
              type="text"
              inputMode="decimal"
              placeholder="22.00"
              defaultValue={state.values?.pay_rate}
            />
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send invitation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
