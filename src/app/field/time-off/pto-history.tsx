"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cancelSelfPtoRequestAction,
  updateSelfPtoRequestAction,
} from "@/app/app/timesheets/actions";
import {
  workerCanCancel,
  workerCanEdit,
  type PtoStatus,
} from "@/lib/pto-rules";

export type PtoHistoryRow = {
  id: string;
  start_date: string;
  end_date: string;
  hours: number;
  status: PtoStatus;
  reason: string | null;
};

/**
 * The requester's own time off, with the controls that used to not exist:
 * cancel while any day is still ahead, change before it starts. Changing
 * an APPROVED request sends it back for re-approval — the manager said yes
 * to specific dates, and different dates are a different question. Before
 * this, the only "edit" a worker had was filing a second request and
 * leaving the stale one approved forever.
 */
export function PtoHistory({
  rows,
  todayYmd,
  hideHours = false,
}: {
  rows: PtoHistoryRow[];
  todayYmd: string;
  /** Subcontractors: time off is unpaid unavailability — hours aren't shown
   *  or editable (the server stores 0 for them regardless). */
  hideHours?: boolean;
}) {
  const [editing, setEditing] = useState<PtoHistoryRow | null>(null);

  if (rows.length === 0) return null;

  return (
    <>
      <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your requests
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((req) => (
          <HistoryRow
            key={req.id}
            req={req}
            todayYmd={todayYmd}
            hideHours={hideHours}
            onEdit={() => setEditing(req)}
          />
        ))}
      </ul>
      {editing && (
        <SelfEditDialog
          request={editing}
          hideHours={hideHours}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function HistoryRow({
  req,
  todayYmd,
  hideHours,
  onEdit,
}: {
  req: PtoHistoryRow;
  todayYmd: string;
  hideHours: boolean;
  onEdit: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canCancel = workerCanCancel(req.status, req.end_date, todayYmd);
  const canEdit = workerCanEdit(req.status, req.start_date, todayYmd);

  const toneClass =
    req.status === "approved"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : req.status === "declined"
        ? "bg-red-500/10 text-red-700 dark:text-red-300"
        : req.status === "cancelled"
          ? "bg-muted text-muted-foreground"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300";

  function cancel() {
    const warn =
      req.status === "approved"
        ? "Cancel this approved time off? The days go back on the schedule and your manager will be notified."
        : "Cancel this request?";
    if (!confirm(warn)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", req.id);
    startTransition(async () => {
      const res = await cancelSelfPtoRequestAction(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <li className="px-3 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {req.start_date}
            {req.start_date !== req.end_date && ` → ${req.end_date}`}
          </div>
          <div className="text-muted-foreground">
            {hideHours
              ? (req.reason ?? "Unavailable")
              : `${req.hours}h${req.reason ? ` · ${req.reason}` : ""}`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onEdit}
              disabled={isPending}
              aria-label="Change request"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={isPending}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Cancel request"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Ban className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase ${toneClass}`}
          >
            {req.status}
          </span>
        </div>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </li>
  );
}

function SelfEditDialog({
  request,
  hideHours,
  onClose,
}: {
  request: PtoHistoryRow;
  hideHours: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    formData.set("id", request.id);
    startTransition(async () => {
      const res = await updateSelfPtoRequestAction(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change time-off request</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="self-pto-start"
                className="mb-1 block text-xs font-medium"
              >
                Start date
              </label>
              <Input
                id="self-pto-start"
                name="start_date"
                type="date"
                required
                defaultValue={request.start_date}
                disabled={isPending}
              />
            </div>
            <div>
              <label
                htmlFor="self-pto-end"
                className="mb-1 block text-xs font-medium"
              >
                End date
              </label>
              <Input
                id="self-pto-end"
                name="end_date"
                type="date"
                required
                defaultValue={request.end_date}
                disabled={isPending}
              />
            </div>
          </div>
          {hideHours ? (
            <input type="hidden" name="hours" value="0" />
          ) : (
            <div>
              <label
                htmlFor="self-pto-hours"
                className="mb-1 block text-xs font-medium"
              >
                Hours
              </label>
              <Input
                id="self-pto-hours"
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
              htmlFor="self-pto-reason"
              className="mb-1 block text-xs font-medium"
            >
              Reason (optional)
            </label>
            <Textarea
              id="self-pto-reason"
              name="reason"
              rows={2}
              defaultValue={request.reason ?? ""}
              disabled={isPending}
            />
          </div>
          {request.status === "approved" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-200">
              This request is already approved — changing it sends it back to
              your manager for re-approval.
            </p>
          )}
          {error && <p className="text-[11px] text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isPending}
            >
              Back
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
