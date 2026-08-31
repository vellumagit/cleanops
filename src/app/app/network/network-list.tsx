"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Mail, Pencil, Phone, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  NETWORK_CATEGORIES,
  networkCategoryLabel,
} from "@/lib/validators/network";

export type NetworkContactRow = {
  id: string;
  name: string;
  category: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

/**
 * The rolodex list — built phone-first, because "call the realtor from
 * the driveway" is the whole point: card rows, tap-to-call and
 * tap-to-email links, search + category chips.
 */
export function NetworkList({ rows }: { rows: NetworkContactRow[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (!q) return true;
      return [r.name, r.company, r.email, r.phone, r.notes]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
  }, [rows, query, category]);

  const usedCategories = new Set(rows.map((r) => r.category));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, company, notes…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              category === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {NETWORK_CATEGORIES.filter((c) => usedCategories.has(c.key)).map(
            (c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  category === c.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ),
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "Nobody in the network yet — add the first realtor, supplier, or partner."
            : "No contacts match."}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {networkCategoryLabel(r.category)}
                    {r.company ? ` · ${r.company}` : ""}
                  </p>
                </div>
                <Link
                  href={`/app/network/${r.id}/edit`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Edit ${r.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Link>
              </div>

              {(r.phone || r.email) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {r.phone && (
                    <a
                      href={`tel:${r.phone}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {r.phone}
                    </a>
                  )}
                  {r.email && (
                    <a
                      href={`mailto:${r.email}`}
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{r.email}</span>
                    </a>
                  )}
                </div>
              )}

              {r.notes && (
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {r.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
