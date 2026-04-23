"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Generic, reusable client-side DataTable.
 *
 * Features:
 *   - Search across configurable columns
 *   - Empty state
 *   - Row click handler
 *   - Customizable cell rendering via render fn
 *   - Fully type-safe with generics
 *
 * Used by every list page in the ops console.
 */

export type DataTableColumn<T> = {
  /** Stable key for the column (for React keys). */
  key: string;
  /** Header label. */
  header: string;
  /** Render fn for the cell. */
  render: (row: T) => React.ReactNode;
  /**
   * Optional — return a string used as the search needle for this column.
   * If omitted, this column is NOT included in search. At least one column
   * should define this unless you pass `searchable={false}`.
   */
  searchValue?: (row: T) => string | null | undefined;
  /** Optional cell class — e.g. `text-right`, `font-mono` */
  className?: string;
  /** Optional header class — e.g. `text-right` */
  headerClassName?: string;
};

type Props<T> = {
  data: T[];
  columns: DataTableColumn<T>[];
  /** Extract the React key for each row. */
  getRowId: (row: T) => string;
  /** Placeholder shown in the search input. */
  searchPlaceholder?: string;
  /** Turn search off entirely. */
  searchable?: boolean;
  /** What to show when there are zero rows (before filtering). */
  emptyState?: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  };
  /** Click handler for a row (e.g. navigate to detail page). */
  onRowClick?: (row: T) => void;
};

export function DataTable<T>({
  data,
  columns,
  getRowId,
  searchPlaceholder = "Search…",
  searchable = true,
  emptyState,
  onRowClick,
}: Props<T>) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return data;
    const needle = query.trim().toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        if (!col.searchValue) return false;
        const v = col.searchValue(row);
        if (v == null) return false;
        return v.toLowerCase().includes(needle);
      }),
    );
  }, [query, data, columns]);

  const showEmptyState = data.length === 0 && emptyState;
  const showNoMatches = data.length > 0 && filtered.length === 0;

  // Press "/" anywhere (outside a text input) to focus the search. Common
  // convention borrowed from GitHub / Slack — cheap discoverability win
  // on tables with hundreds of rows.
  useEffect(() => {
    if (!searchable) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Don't hijack the slash when the user is typing somewhere.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchable]);

  return (
    <div className="flex flex-col gap-3">
      {searchable && data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8 pr-10"
            />
            {/* Keyboard hint, hidden on small screens where the physical
                keyboard is rare. */}
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              /
            </kbd>
          </div>
          {/* Result count — makes it obvious the table is searchable and
              gives instant feedback on filter state. */}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {query ? (
              <>
                {filtered.length.toLocaleString()} of{" "}
                {data.length.toLocaleString()}
              </>
            ) : (
              <>{data.length.toLocaleString()} total</>
            )}
          </span>
        </div>
      )}

      {showEmptyState ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {emptyState.title}
          </p>
          {emptyState.description && (
            <p className="mt-1 text-xs text-muted-foreground">
              {emptyState.description}
            </p>
          )}
          {emptyState.action && <div className="mt-4">{emptyState.action}</div>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-3 py-2 text-left text-xs font-medium text-muted-foreground",
                      col.headerClassName,
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showNoMatches ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-12 text-center text-xs text-muted-foreground"
                  >
                    No matches for &ldquo;{query}&rdquo;.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={getRowId(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "border-b border-border last:border-0",
                      onRowClick &&
                        "cursor-pointer transition-colors hover:bg-muted/30",
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2.5 align-middle",
                          col.className,
                        )}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
