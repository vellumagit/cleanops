"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  archiveClientAction,
  deleteClientAction,
  type ClientDeleteBlocker,
} from "../../actions";

const KIND_LABEL: Record<ClientDeleteBlocker["kind"], [string, string]> = {
  booking: ["booking", "bookings"],
  invoice: ["invoice", "invoices"],
  estimate: ["estimate", "estimates"],
  contract: ["contract", "contracts"],
};

/**
 * Delete a client, and when that is refused, say why RIGHT HERE.
 *
 * The refusal used to come back as a redirect to this same page, which
 * reloaded it at the top with the explanation down in the danger zone: the
 * button seemed to do nothing. Now the action answers in place: what is in
 * the way, a link to each record, what to do in order, and Archive one press
 * away for the usual case.
 */
export function DeleteClientForm({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<{ error: string; blockers: ClientDeleteBlocker[] } | null>(null);

  // The explanation opens above the button and can be taller than what is
  // left of the screen: bring all of it into view, without jumping anywhere
  // it doesn't need to.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (refusal) panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [refusal]);

  function fd() {
    const f = new FormData();
    f.set("id", id);
    return f;
  }

  function remove() {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    startTransition(async () => {
      // On success the action redirects to the client list and never returns.
      const res = await deleteClientAction(fd());
      if (res && !res.ok) setRefusal({ error: res.error, blockers: res.blockers });
    });
  }

  function archive() {
    if (!window.confirm(`Archive ${name}? Their open bookings are cancelled and they leave your lists. Their records stay, and you can restore them later.`)) return;
    startTransition(async () => {
      const res = await archiveClientAction(fd());
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${name} archived`);
      router.push("/app/clients");
    });
  }

  return (
    <div className="space-y-3">
      {refusal && (
        <div
          ref={panel}
          role="alert"
          className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <p className="font-semibold">{refusal.error}</p>
          <ul className="mt-2 space-y-3">
            {refusal.blockers.map((b) => (
              <li key={b.kind}>
                <p className="font-medium">
                  {b.count} {KIND_LABEL[b.kind][b.count === 1 ? 0 : 1]}
                </p>
                <p className="opacity-90">{b.how}</p>
                <ul className="mt-1 space-y-0.5">
                  {b.items.map((it) => (
                    <li key={it.id}>
                      <Link href={it.href} className="underline underline-offset-2">
                        {it.label}
                      </Link>
                    </li>
                  ))}
                  {b.count > b.items.length && (
                    <li className="opacity-80">and {b.count - b.items.length} more</li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={archive}>
              Archive {name} instead
            </Button>
          </div>
        </div>
      )}
      <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
        {pending ? "Working…" : "Delete client"}
      </Button>
    </div>
  );
}
