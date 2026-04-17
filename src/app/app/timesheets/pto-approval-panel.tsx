"use client";

import { useTransition } from "react";
import { Check, X, Palmtree, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updatePtoStatusAction } from "./actions";
import type { PtoEntry } from "./types";

export function PtoApprovalPanel({ requests }: { requests: PtoEntry[] }) {
  const pending = requests.filter((r) => r.status === "pending");

  if (pending.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Palmtree className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold">
          {pending.length} pending PTO request
          {pending.length === 1 ? "" : "s"}
        </h2>
      </div>
      <ul className="space-y-2">
        {pending.map((req) => (
          <PtoRow key={req.id} request={req} />
        ))}
      </ul>
    </div>
  );
}

function PtoRow({ request }: { request: PtoEntry }) {
  const [isPending, startTransition] = useTransition();

  function act(status: "approved" | "declined") {
    const fd = new FormData();
    fd.set("id", request.id);
    fd.set("status", status);
    startTransition(async () => {
      await updatePtoStatusAction(fd);
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {request.employee_name ?? "Employee"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {request.start_date}
            {request.start_date !== request.end_date && ` → ${request.end_date}`}
            {" · "}
            {request.hours}h
          </span>
        </div>
        {request.reason && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {request.reason}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
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
      </div>
    </li>
  );
}
