"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore } from "lucide-react";
import {
  archiveClientAction,
  unarchiveClientAction,
} from "../actions";

/**
 * The "done with this client" control — both directions.
 *
 * Archive is one swift movement, so the confirm has to say exactly what the
 * movement does: cancel N future bookings, pause M recurring series, lock
 * the portal, drop them from every picker and billing run. The counts come
 * from the server page render, so the owner reads the consequences BEFORE
 * agreeing to them. Restore is the same card in reverse, minus the sweep —
 * bookings and series stay as the archive left them, and the card says so.
 */
export function ArchiveClientCard({
  clientId,
  clientName,
  archived,
  futureBookings,
  activeSeries,
  hasPortalAccess,
}: {
  clientId: string;
  clientName: string;
  archived: boolean;
  /** Every still-live pending/confirmed booking — what archive will cancel.
   *  Includes ones already in the past: a job that never happened and was
   *  never cancelled is exactly the loose end archiving ties off. */
  futureBookings: number;
  /** Recurring series still generating — what archive will pause. */
  activeSeries: number;
  hasPortalAccess: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const consequences = [
    futureBookings > 0 &&
      `cancel ${futureBookings} open booking${futureBookings === 1 ? "" : "s"}`,
    activeSeries > 0 &&
      `pause ${activeSeries} recurring schedule${activeSeries === 1 ? "" : "s"}`,
    hasPortalAccess && "lock their portal sign-in",
    "hide them from every list, picker, and billing run",
  ].filter(Boolean) as string[];

  function run() {
    if (archived) {
      startTransition(async () => {
        const res = await unarchiveClientAction(fd());
        // Toast, not inline state: the restore button renders alone inside
        // the banner, so a failure has to speak from somewhere visible.
        if (!res.ok) return void toast.error(res.error);
        toast.success(`${clientName} restored`);
        router.refresh();
      });
      return;
    }
    const ok = window.confirm(
      `Archive ${clientName}? This will ${consequences.join(", ")}. Their history and any unpaid invoices stay. You can restore them later — cancelled bookings stay cancelled.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await archiveClientAction(fd());
      if (!res.ok) return void toast.error(res.error);
      const parts = [
        res.cancelledBookings > 0 &&
          `${res.cancelledBookings} booking${res.cancelledBookings === 1 ? "" : "s"} cancelled`,
        res.pausedSeries > 0 &&
          `${res.pausedSeries} schedule${res.pausedSeries === 1 ? "" : "s"} paused`,
      ].filter(Boolean);
      toast.success(
        parts.length > 0
          ? `${clientName} archived — ${parts.join(", ")}`
          : `${clientName} archived`,
      );
      router.refresh();
    });
  }

  function fd() {
    const f = new FormData();
    f.set("id", clientId);
    return f;
  }

  if (archived) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        <ArchiveRestore className="h-3.5 w-3.5" />
        {pending ? "Restoring…" : "Restore client"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Done with this client?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Archiving will {consequences.join(", ")}. History and unpaid
            invoices stay; restoring later is one click.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Archive className="h-3.5 w-3.5" />
          {pending ? "Archiving…" : "Archive client"}
        </button>
      </div>
    </div>
  );
}
