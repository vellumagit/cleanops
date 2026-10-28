import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { collectNeedsYou, type NeedsYouItem } from "@/lib/needs-you";
import { NeedsYouButtons } from "./needs-you-buttons";

/**
 * The dashboard's "Needs you" list: every question the jobs are asking a
 * manager right now, each with its answers as buttons. Silent when there's
 * nothing — an empty list is the good news. Never takes the dashboard
 * down: a failed load renders nothing.
 *
 * Replaced the "Needs a look" card (money-shaped loose ends, links only).
 * The unpriced-job bucket lives on here as an item with a Set price button;
 * unbilled finished work is the invoices page's job.
 */
export async function NeedsYou({ organizationId }: { organizationId: string }) {
  let items: NeedsYouItem[];
  try {
    items = (await collectNeedsYou(organizationId)).items;
  } catch (err) {
    console.error("[needs-you] failed to load:", err);
    return null;
  }
  if (items.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Needs you
        </h2>
        <span className="text-xs text-amber-900/70 dark:text-amber-200/70">
          {items.length} {items.length === 1 ? "thing" : "things"}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-amber-900/10 dark:divide-amber-200/10">
        {items.map((it) => (
          <li key={it.key} className="py-3 first:pt-0 last:pb-0">
            <Link
              href={it.href}
              className="text-sm font-semibold text-foreground underline-offset-2 hover:underline"
            >
              {it.title}
            </Link>
            {it.body && (
              <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
                {it.body}
              </p>
            )}
            <NeedsYouButtons actions={it.actions} />
          </li>
        ))}
      </ul>
    </div>
  );
}
