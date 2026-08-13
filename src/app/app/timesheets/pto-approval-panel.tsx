"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Check,
  X,
  Palmtree,
  Loader2,
  Trash2,
  Pencil,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import {
  updatePtoStatusAction,
  updatePtoRequestAction,
  deletePtoRequestAction,
} from "./actions";
import type { PtoEntry } from "./types";

/**
 * Time-off management — the whole lifecycle, not just the pending queue.
 *
 * The original panel rendered ONLY pending requests and vanished once none
 * were. Every approved/declined/cancelled request became invisible and
 * therefore unmanageable, even though the server actions for cancelling and
 * deleting them existed the whole time: when Olha replaced a vacation
 * request, the obsolete APPROVED one kept blocking her days on the
 * scheduler and no screen in the app could touch it.
 */
export function PtoApprovalPanel({ requests }: { requests: PtoEntry[] }) {
  const [editing, setEditing] = useState<PtoEntry | null>(null);

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests
    .filter((r) => r.status !== "pending")
    // Most future-relevant first — an upcoming approved block is what a
    // manager most likely needs to change; ancient history sinks.
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  return (
    <div className="mt-4 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Palmtree className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Time off</h2>
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            {pending.length} pending
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          No time-off requests in this date range.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {pending.map((req) => (
            <PtoRow
              key={req.id}
              request={req}
              onEdit={() => setEditing(req)}
            />
          ))}
          {decided.map((req) => (
            <PtoRow
              key={req.id}
              request={req}
              onEdit={() => setEditing(req)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <PtoEditDialog request={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function statusTone(status: PtoEntry["status"]): StatusTone {
  switch (status) {
    case "approved":
      return "green";
    case "declined":
      return "red";
    case "cancelled":
      return "neutral";
    default:
      return "amber";
  }
}

function PtoRow({
  request,
  onEdit,
}: {
  request: PtoEntry;
  onEdit: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const isOpen = request.status === "pending";

  function act(status: "approved" | "declined" | "cancelled") {
    const fd = new FormData();
    fd.set("id", request.id);
    fd.set("status", status);
    startTransition(async () => {
      const res = await updatePtoStatusAction(fd);
      if (!res.ok) toast.error(res.error);
      else if (status === "cancelled") toast.success("Time off cancelled");
    });
  }

  function remove() {
    if (!confirm("Delete this time-off request? This can't be undone."))
      return;
    const fd = new FormData();
    fd.set("id", request.id);
    startTransition(async () => {
      const res = await deletePtoRequestAction(fd);
      if (!res.ok) toast.error(res.error);
      else toast.success("Request deleted");
    });
  }

  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
        isOpen ? "bg-amber-500/5" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {request.employee_name ?? "Employee"}
          {request.engagement === "subcontractor" && (
            <span
              title="Subcontractor — approving marks them unavailable. No PTO hours, no pay attaches."
              className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground"
            >
              Subcontractor · unpaid
            </span>
          )}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {request.start_date}
            {request.start_date !== request.end_date &&
              ` → ${request.end_date}`}
            {request.engagement !== "subcontractor" &&
              ` · ${request.hours}h`}
          </span>
        </div>
        {request.reason && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {request.reason}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {!isOpen && (
          <StatusBadge tone={statusTone(request.status)}>
            {request.status}
          </StatusBadge>
        )}
        {(isOpen || request.status === "approved") && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onEdit}
            disabled={isPending}
            aria-label="Edit request"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {request.status === "approved" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => act("cancelled")}
            disabled={isPending}
            className="text-muted-foreground hover:text-destructive"
            title="Cancel this time off — frees the days on the schedule"
          >
            <Ban className="h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={remove}
          disabled={isPending}
          className="text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label="Delete request"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {isOpen && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => act("declined")}
              disabled={isPending}
              className="text-red-600 hover:text-red-700 hover:bg-red-500/10"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Decline
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => act("approved")}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function PtoEditDialog({
  request,
  onClose,
}: {
  request: PtoEntry;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    formData.set("id", request.id);
    startTransition(async () => {
      const res = await updatePtoRequestAction(formData);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Request updated");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Edit time off — {request.employee_name ?? "employee"}
          </DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="pto-edit-start"
                className="mb-1 block text-xs font-medium"
              >
                Start date
              </label>
              <Input
                id="pto-edit-start"
                name="start_date"
                type="date"
                required
                defaultValue={request.start_date}
                disabled={isPending}
              />
            </div>
            <div>
              <label
                htmlFor="pto-edit-end"
                className="mb-1 block text-xs font-medium"
              >
                End date
              </label>
              <Input
                id="pto-edit-end"
                name="end_date"
                type="date"
                required
                defaultValue={request.end_date}
                disabled={isPending}
              />
            </div>
          </div>
          {request.engagement === "subcontractor" ? (
            // Unpaid unavailability — hours don't exist for a contractor's
            // time off. The server forces 0 regardless of what's posted.
            <input type="hidden" name="hours" value="0" />
          ) : (
            <div>
              <label
                htmlFor="pto-edit-hours"
                className="mb-1 block text-xs font-medium"
              >
                Hours
              </label>
              <Input
                id="pto-edit-hours"
                name="hours"
                type="number"
                min={1}
                max={200}
                step={0.5}
                required
                defaultValue={request.hours}
                disabled={isPending}
              />
            </div>
          )}
          <div>
            <label
              htmlFor="pto-edit-reason"
              className="mb-1 block text-xs font-medium"
            >
              Reason (optional)
            </label>
            <Textarea
              id="pto-edit-reason"
              name="reason"
              rows={2}
              defaultValue={request.reason ?? ""}
              disabled={isPending}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            The request keeps its current status ({request.status}) — you are
            the approval, so your edit is the answer.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
