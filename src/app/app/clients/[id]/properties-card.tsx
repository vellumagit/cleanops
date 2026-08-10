"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Plus, Pencil, KeyRound, Archive } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import {
  saveClientPropertyAction,
  archiveClientPropertyAction,
  type PropertyFormState,
} from "./property-actions";

export type PropertyRow = {
  id: string;
  label: string;
  address: string | null;
  access_notes: string | null;
  default_checklist_template_id: string | null;
  notes: string | null;
  bookingCount: number;
};

const initial: PropertyFormState = {};

/**
 * The places one client has cleaned.
 *
 * Shown for every client, because the only way to discover that a second
 * property is possible is to see the first one sitting there. It stays quiet
 * for the ordinary single-address client — one row, no ceremony — and becomes
 * the primary way to navigate the client the moment there are several.
 */
export function ClientPropertiesCard({
  clientId,
  properties,
  checklistTemplates,
  canEdit,
}: {
  clientId: string;
  properties: PropertyRow[];
  checklistTemplates: Array<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Properties</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {properties.length === 0
              ? "Nowhere on file yet."
              : properties.length === 1
                ? "One place. Add another if this client owns more than one."
                : `${properties.length} places. Each job picks one.`}
          </p>
        </div>
        {canEdit && (
          <PropertyDialog
            clientId={clientId}
            checklistTemplates={checklistTemplates}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="h-3.5 w-3.5" />
                Add property
              </Button>
            }
          />
        )}
      </div>

      {properties.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Add a property to pick it when booking, and to give the cleaner its
          own access notes.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {properties.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{p.label}</p>
                {p.address && (
                  <p className="text-xs text-muted-foreground">{p.address}</p>
                )}
                {p.access_notes && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
                    <KeyRound className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="whitespace-pre-wrap">{p.access_notes}</span>
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {p.bookingCount === 0
                    ? "No jobs yet"
                    : `${p.bookingCount} job${p.bookingCount === 1 ? "" : "s"}`}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <PropertyDialog
                    clientId={clientId}
                    property={p}
                    checklistTemplates={checklistTemplates}
                    trigger={
                      <Button variant="ghost" size="icon-sm">
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="sr-only">Edit {p.label}</span>
                      </Button>
                    }
                  />
                  <ArchiveButton property={p} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PropertyDialog({
  clientId,
  property,
  checklistTemplates,
  trigger,
}: {
  clientId: string;
  property?: PropertyRow;
  checklistTemplates: Array<{ id: string; name: string }>;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(property?.address ?? "");
  const [state, formAction, pending] = useActionState(
    saveClientPropertyAction,
    initial,
  );

  // Reacting to a returned action state is what useActionState is for; the
  // close can't live in the action itself. Same suppression and same reason
  // as add-manual-dialog.tsx:53.
  useEffect(() => {
    if (state.done) {
      toast.success(property ? "Property updated." : "Property added.");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      router.refresh();
    }
  }, [state.done, property, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {property ? "Edit property" : "Add property"}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="client_id" value={clientId} />
          {property && (
            <input type="hidden" name="property_id" value={property.id} />
          )}

          {state.errors?._form && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {state.errors._form}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="label">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="label"
              name="label"
              required
              defaultValue={property?.label ?? ""}
              placeholder="e.g. Whyte Ave suite"
              aria-invalid={Boolean(state.errors?.label)}
            />
            {state.errors?.label && (
              <p className="text-xs text-destructive">{state.errors.label}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              What you and the cleaners call it. This is what shows on the job.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="property-address">Address</Label>
            <AddressAutocomplete
              id="property-address"
              name="address"
              value={address}
              onChange={setAddress}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="access_notes">Getting in</Label>
            <Textarea
              id="access_notes"
              name="access_notes"
              rows={2}
              defaultValue={property?.access_notes ?? ""}
              placeholder="Lockbox 4821, side door. Park in stall 12."
            />
            <p className="text-[11px] text-muted-foreground">
              Shown to the crew on the job screen. Codes, key location, parking.
            </p>
          </div>

          {checklistTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="checklist">Checklist</Label>
              <select
                id="checklist"
                name="default_checklist_template_id"
                defaultValue={property?.default_checklist_template_id ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Use the client&rsquo;s default</option>
                {checklistTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="property-notes">Notes</Label>
            <Textarea
              id="property-notes"
              name="notes"
              rows={2}
              defaultValue={property?.notes ?? ""}
              placeholder="Anything else about this place."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : property ? "Save" : "Add property"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveButton({ property }: { property: PropertyRow }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      onClick={async () => {
        // Named rather than counted: "Archive 2 jobs?" is a question about
        // rows, "Archive Whyte Ave suite?" is a question about a place.
        if (
          !confirm(
            `Archive ${property.label}? Its ${property.bookingCount} job${property.bookingCount === 1 ? "" : "s"} stay exactly as they are — it just stops appearing when booking.`,
          )
        ) {
          return;
        }
        setPending(true);
        const fd = new FormData();
        fd.set("property_id", property.id);
        const res = await archiveClientPropertyAction(fd);
        setPending(false);
        if (res.ok) {
          toast.success(`${property.label} archived.`);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      }}
    >
      <Archive className="h-3.5 w-3.5" />
      <span className="sr-only">Archive {property.label}</span>
    </Button>
  );
}
