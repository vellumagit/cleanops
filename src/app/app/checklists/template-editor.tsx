"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { parseChecklistPaste, type ChecklistKind } from "@/lib/checklist-paste";
import {
  createChecklistTemplateAction,
  updateChecklistTemplateAction,
} from "./actions";

type Item = {
  key: string;
  title: string;
  phase: "pre" | "during" | "post";
  is_required: boolean;
  /** item = a task to tick; section / subsection = a heading over the tasks. */
  kind: ChecklistKind;
};

type Props = {
  mode: "create" | "edit";
  templateId?: string;
  initialName?: string;
  initialDescription?: string;
  /** service_types.id this template auto-attaches to, "" = none. */
  initialServiceTypeId?: string;
  /** The org's real service catalog — not the legacy hardcoded enum. */
  services: Array<{ id: string; label: string }>;
  initialItems?: Item[];
};

/** Row type: a task to tick, or a heading (section = room, group = within it). */
function KindSelect({
  value,
  onChange,
}: {
  value: ChecklistKind;
  onChange: (kind: ChecklistKind) => void;
}) {
  return (
    <FormSelect
      value={value}
      onChange={(e) => onChange(e.target.value as ChecklistKind)}
      aria-label="Row type"
    >
      <option value="item">Task</option>
      <option value="section">Section</option>
      <option value="subsection">Group</option>
    </FormSelect>
  );
}

function emptyItem(kind: ChecklistKind = "item"): Item {
  return {
    key: crypto.randomUUID(),
    title: "",
    phase: "during",
    is_required: false,
    kind,
  };
}

export function TemplateEditor({
  mode,
  templateId,
  initialName = "",
  initialDescription = "",
  initialServiceTypeId = "",
  services,
  initialItems,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [serviceTypeId, setServiceTypeId] = useState(initialServiceTypeId);
  const [items, setItems] = useState<Item[]>(
    initialItems && initialItems.length > 0 ? initialItems : [emptyItem()],
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  function addItem(kind: ChecklistKind = "item") {
    setItems((p) => [...p, emptyItem(kind)]);
  }

  /**
   * "Paste a list": a whole checklist written in an email becomes sections,
   * groups and tasks in one go (lib/checklist-paste.ts). Replaces the rows
   * when the editor only holds the empty starter row, appends otherwise —
   * and every row's type stays editable, so a wrong guess is one click.
   */
  function applyPaste(mode: "append" | "replace") {
    const parsed = parseChecklistPaste(pasteText).map((r) => ({
      ...emptyItem(r.kind),
      title: r.title,
    }));
    if (parsed.length === 0) {
      toast.error("Nothing to add — paste a list with one item per line.");
      return;
    }
    setItems((p) => {
      const onlyBlank = p.every((i) => !i.title.trim());
      return mode === "replace" || onlyBlank ? parsed : [...p, ...parsed];
    });
    const tasks = parsed.filter((r) => r.kind === "item").length;
    const headings = parsed.length - tasks;
    toast.success(
      `Added ${tasks} task${tasks === 1 ? "" : "s"} under ${headings} heading${headings === 1 ? "" : "s"}. Check the types, then save.`,
    );
    setPasteText("");
    setPasteOpen(false);
  }
  function removeItem(key: string) {
    setItems((p) => {
      const next = p.filter((i) => i.key !== key);
      return next.length === 0 ? [emptyItem()] : next;
    });
  }
  function updateItem(key: string, patch: Partial<Item>) {
    setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Template name is required.");
      return;
    }
    const trimmedItems = items.filter((i) => i.title.trim().length > 0);
    if (!trimmedItems.some((i) => i.kind === "item")) {
      setFormError("Add at least one task — headings alone have nothing to tick.");
      return;
    }

    const fd = new FormData();
    fd.set("name", name);
    fd.set("description", description);
    fd.set("applies_to_service_type_id", serviceTypeId);
    for (const it of trimmedItems) {
      fd.append(
        "items",
        JSON.stringify({
          title: it.title.trim(),
          phase: it.phase,
          is_required: it.kind === "item" && it.is_required,
          kind: it.kind,
        }),
      );
    }

    startTransition(async () => {
      const result =
        mode === "edit" && templateId
          ? await updateChecklistTemplateAction(templateId, fd)
          : await createChecklistTemplateAction(fd);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toast.success(mode === "edit" ? "Template saved" : "Template created");
      router.push("/app/checklists");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {formError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Move-out deep clean"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applies_to">Auto-add to a service</Label>
          <FormSelect
            id="applies_to"
            value={serviceTypeId}
            onChange={(e) => setServiceTypeId(e.target.value)}
          >
            <option value="">No — attach by hand or per client</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                Every {s.label} booking
              </option>
            ))}
          </FormSelect>
          <p className="text-[11px] text-muted-foreground">
            Pick a service and this checklist lands on every new booking of
            it — including recurring visits and the ones already scheduled.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Optional — what's this checklist for?"
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Items</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPasteOpen((o) => !o)}
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              Paste a list
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addItem("section")}
            >
              <Plus className="h-3.5 w-3.5" />
              Section
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addItem()}
            >
              <Plus className="h-3.5 w-3.5" />
              Task
            </Button>
          </div>
        </div>

        {pasteOpen && (
          <div className="mb-4 space-y-2 rounded-md border border-dashed border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              One line each. <strong>ALL CAPS</strong> lines become sections
              (rooms), short labels become groups (&ldquo;Appliances&rdquo;,
              &ldquo;Sink &amp; Fixtures&rdquo;), and everything else is a
              task. You can change any row&apos;s type afterwards.
            </p>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              placeholder={
                "KITCHEN\nAppliances\nClean inside and outside of microwave\nDegrease range hood, filters and vents"
              }
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPasteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyPaste("append")}
              >
                Add below
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => applyPaste("replace")}
              >
                Replace all items
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {items.map((it) =>
            it.kind !== "item" ? (
              // A heading row: just its name and level — no phase, nothing
              // to require.
              <div
                key={it.key}
                className={cn(
                  "flex flex-col gap-2 rounded-md p-2 sm:grid sm:grid-cols-[16px_minmax(0,1fr)_88px_112px_96px_32px] sm:items-center sm:gap-2",
                  it.kind === "section" ? "mt-3 bg-muted/60" : "bg-muted/30 sm:ml-3",
                )}
              >
                <GripVertical className="hidden h-4 w-4 text-muted-foreground/40 sm:block" />
                <Input
                  value={it.title}
                  onChange={(e) =>
                    updateItem(it.key, { title: e.target.value })
                  }
                  placeholder={
                    it.kind === "section" ? "e.g. KITCHEN" : "e.g. Appliances"
                  }
                  className={cn(
                    "min-w-0",
                    it.kind === "section" ? "font-semibold" : "font-medium",
                  )}
                />
                <KindSelect
                  value={it.kind}
                  onChange={(kind) => updateItem(it.key, { kind })}
                />
                <span className="hidden sm:col-span-2 sm:block" />
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  aria-label="Remove heading"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
            <div
              key={it.key}
              className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:ml-6 sm:grid sm:grid-cols-[16px_minmax(0,1fr)_88px_112px_96px_32px] sm:items-center sm:gap-2"
            >
              <GripVertical className="hidden h-4 w-4 text-muted-foreground/40 sm:block" />
              <Input
                value={it.title}
                onChange={(e) =>
                  updateItem(it.key, { title: e.target.value })
                }
                placeholder="e.g. Vacuum all floors"
                className="min-w-0"
              />
              <KindSelect
                value={it.kind}
                onChange={(kind) => updateItem(it.key, { kind })}
              />
              <FormSelect
                value={it.phase}
                onChange={(e) =>
                  updateItem(it.key, {
                    phase: e.target.value as "pre" | "during" | "post",
                  })
                }
              >
                <option value="pre">Before job</option>
                <option value="during">During job</option>
                <option value="post">After job</option>
              </FormSelect>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium",
                  it.is_required
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={it.is_required}
                  onChange={(e) =>
                    updateItem(it.key, { is_required: e.target.checked })
                  }
                  className="h-3.5 w-3.5"
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => removeItem(it.key)}
                aria-label="Remove item"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            ),
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/app/checklists")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "edit"
              ? "Save changes"
              : "Create template"}
        </Button>
      </div>
    </form>
  );
}
