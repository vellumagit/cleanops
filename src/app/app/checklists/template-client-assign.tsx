import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  assignChecklistToClientAction,
  unassignChecklistFromClientAction,
} from "./actions";

type ClientLite = { id: string; name: string };

/**
 * Assign this checklist template to clients, right from the template. Setting a
 * client makes it their default checklist — auto-added to every booking (via the
 * apply_client_checklist trigger) and backfilled onto their upcoming ones.
 */
export function TemplateClientAssign({
  templateId,
  assigned,
  unassigned,
}: {
  templateId: string;
  assigned: ClientLite[];
  unassigned: ClientLite[];
}) {
  return (
    <section className="mx-auto mt-10 max-w-3xl border-t border-border pt-6">
      <h2 className="text-sm font-semibold">Assign to clients</h2>
      <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
        Clients using this checklist. It&apos;s added automatically to every one
        of their bookings — the ones already scheduled and all future ones — and
        cleaners tick it off in the field app.
      </p>

      {assigned.length > 0 ? (
        <ul className="mb-4 flex flex-wrap gap-2">
          {assigned.map((c) => (
            <li key={c.id}>
              <form
                action={async (formData) => {
                  "use server";
                  await unassignChecklistFromClientAction(formData);
                }}
                className="inline-flex"
              >
                <input type="hidden" name="template_id" value={templateId} />
                <input type="hidden" name="client_id" value={c.id} />
                <button
                  type="submit"
                  title="Remove"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/60"
                >
                  {c.name}
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-xs text-muted-foreground">
          Not assigned to any client yet.
        </p>
      )}

      <form
        action={async (formData) => {
          "use server";
          await assignChecklistToClientAction(formData);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="template_id" value={templateId} />
        <select
          name="client_id"
          required
          defaultValue=""
          className="h-9 min-w-[15rem] max-w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="" disabled>
            Assign to a client…
          </option>
          {unassigned.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonVariants({ size: "sm" })}>
          Assign
        </button>
      </form>
    </section>
  );
}
