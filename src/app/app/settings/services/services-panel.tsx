"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Pencil,
  Plus,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ServiceTypeForm } from "./service-type-form";
import {
  archiveServiceTypeAction,
  unarchiveServiceTypeAction,
} from "./actions";

export type ServiceTypeRow = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  default_duration_minutes: number | null;
  default_price_cents: number | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
};

/**
 * Top-level layout for the Services settings page. Shows the active
 * catalog, lets admins expand a row to edit it inline, opens a new
 * row above the list when "Add service" is clicked, and lists
 * archived rows in a collapsible section at the bottom.
 */
export function ServicesPanel({
  services,
  currency,
}: {
  services: ServiceTypeRow[];
  currency: "CAD" | "USD";
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = useMemo(
    () => services.filter((s) => s.is_active),
    [services],
  );
  const archived = useMemo(
    () => services.filter((s) => !s.is_active),
    [services],
  );

  function archive(id: string, name: string) {
    if (
      !confirm(
        `Archive "${name}"? It will disappear from the booking form. Historical bookings that used it keep their label.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      await archiveServiceTypeAction(id);
      toast.success("Service archived");
      router.refresh();
    });
  }

  function unarchive(id: string) {
    startTransition(async () => {
      await unarchiveServiceTypeAction(id);
      toast.success("Service restored");
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {active.length} active service{active.length === 1 ? "" : "s"}
          {archived.length > 0 ? ` · ${archived.length} archived` : ""}
        </p>
        {!creating && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add service
          </Button>
        )}
      </div>

      {/* New-row form */}
      {creating && (
        <div className="rounded-lg border border-primary/40 bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold">New service</h3>
          <ServiceTypeForm
            mode="create"
            currency={currency}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* Active list */}
      <ul className="space-y-2">
        {active.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            {editingId === s.id ? (
              <ServiceTypeForm
                mode="edit"
                id={s.id}
                currency={currency}
                defaults={rowToFormDefaults(s)}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  router.refresh();
                }}
              />
            ) : (
              <div className="flex items-start gap-3">
                <div
                  className="mt-1 h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: s.color ?? "transparent" }}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <CategoryBadge category={s.category} />
                  </div>
                  {s.description && (
                    <span className="mt-0.5 text-xs text-muted-foreground">
                      {s.description}
                    </span>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {s.default_duration_minutes != null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(s.default_duration_minutes)}
                      </span>
                    )}
                    {s.default_price_cents != null && (
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        {formatPrice(s.default_price_cents, currency)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(s.id);
                      setCreating(false);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => archive(s.id, s.name)}
                    disabled={pending}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {active.length === 0 && !creating && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          You don&apos;t have any active services. Click <strong>Add
          service</strong> to create one.
        </div>
      )}

      {/* Archived section */}
      {archived.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showArchived ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {archived.length} archived service{archived.length === 1 ? "" : "s"}
          </button>
          {showArchived && (
            <ul className="space-y-2 border-t border-border p-3">
              {archived.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground line-through">
                      {s.name}
                    </span>
                    <CategoryBadge category={s.category} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => unarchive(s.id)}
                    disabled={pending}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <Tag className="h-2.5 w-2.5" />
      {category.replace(/_/g, " ")}
    </span>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatPrice(cents: number, currency: "CAD" | "USD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function rowToFormDefaults(s: ServiceTypeRow) {
  return {
    category: s.category,
    name: s.name,
    description: s.description ?? "",
    default_duration_minutes:
      s.default_duration_minutes != null
        ? String(s.default_duration_minutes)
        : "",
    default_price_cents:
      s.default_price_cents != null
        ? (s.default_price_cents / 100).toFixed(2)
        : "",
    color: s.color ?? "",
    sort_order: String(s.sort_order),
    is_active: s.is_active,
  };
}
