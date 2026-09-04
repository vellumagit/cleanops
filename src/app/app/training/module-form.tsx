"use client";

import { useActionState, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  GripVertical,
  ImagePlus,
  X,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormField, FormError } from "@/components/form-field";
import {
  createTrainingModuleAction,
  updateTrainingModuleAction,
  type TrainingModuleState,
} from "./actions";

type StepData = {
  key: string; // client-side key for React
  title: string;
  body: string;
  imagePreview: string | null;
  imageFile: File | null;
  existingImageUrl: string | null;
  removeImage: boolean;
  /** Optional link — a video, a doc, a page. */
  linkUrl: string;
};

type Props = {
  mode: "create" | "edit";
  moduleId?: string;
  initialTitle?: string;
  initialDescription?: string;
  initialStatus?: string;
  initialAssignOnJoin?: boolean;
  /** Stored membership roles ("employee" | "manager" | "admin" | "owner"). */
  initialAudienceRoles?: string[];
  initialSteps?: Array<{
    title: string;
    body: string;
    image_url: string | null;
    link_url?: string | null;
  }>;
};

/** The three account levels a module can target — combinatory. Admin and
 *  owner travel as one level, matching how the rest of the app treats
 *  them as a single tier of trust. */
const AUDIENCE_LEVELS = [
  {
    value: "employee",
    label: "Employees & contractors",
    hint: "The field crew — cleaners on payroll or on statements",
  },
  {
    value: "manager",
    label: "Managers",
    hint: "People running the day in the office app",
  },
  {
    value: "admins",
    label: "Admins & owners",
    hint: "Full-access accounts",
  },
] as const;

function levelsFromRoles(roles: string[]): Set<string> {
  const s = new Set<string>();
  if (roles.includes("employee")) s.add("employee");
  if (roles.includes("manager")) s.add("manager");
  if (roles.includes("admin") || roles.includes("owner")) s.add("admins");
  return s;
}

let stepKeyCounter = 0;
function nextKey() {
  return `step-${++stepKeyCounter}`;
}

export function ModuleForm({
  mode,
  moduleId,
  initialTitle = "",
  initialDescription = "",
  initialStatus = "draft",
  initialAssignOnJoin = false,
  initialAudienceRoles = ["employee"],
  initialSteps = [],
}: Props) {
  const initialState: TrainingModuleState = {};

  const action =
    mode === "edit" && moduleId
      ? updateTrainingModuleAction.bind(null, moduleId)
      : createTrainingModuleAction;

  const [state, formAction, pending] = useActionState(action, initialState);

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [assignOnJoin, setAssignOnJoin] = useState(initialAssignOnJoin);
  const [audience, setAudience] = useState<Set<string>>(() =>
    levelsFromRoles(initialAudienceRoles),
  );

  function toggleAudience(level: string) {
    setAudience((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }
  const [steps, setSteps] = useState<StepData[]>(() => {
    if (initialSteps.length > 0) {
      return initialSteps.map((s) => {
        // Parse title from body if it starts with **Title**
        let stepTitle = s.title;
        let stepBody = s.body;
        const boldMatch = s.body.match(/^\*\*(.+?)\*\*\n\n([\s\S]*)$/);
        if (boldMatch) {
          stepTitle = boldMatch[1];
          stepBody = boldMatch[2];
        }
        return {
          key: nextKey(),
          title: stepTitle,
          body: stepBody,
          imagePreview: s.image_url,
          imageFile: null,
          existingImageUrl: s.image_url,
          removeImage: false,
          linkUrl: s.link_url ?? "",
        };
      });
    }
    return [
      {
        key: nextKey(),
        title: "",
        body: "",
        imagePreview: null,
        imageFile: null,
        existingImageUrl: null,
        removeImage: false,
        linkUrl: "",
      },
    ];
  });

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        key: nextKey(),
        title: "",
        body: "",
        imagePreview: null,
        imageFile: null,
        existingImageUrl: null,
        removeImage: false,
        linkUrl: "",
      },
    ]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: "up" | "down") {
    setSteps((prev) => {
      const next = [...prev];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
      return next;
    });
  }

  function updateStep(index: number, updates: Partial<StepData>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s)),
    );
  }

  function handleImageChange(index: number, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      updateStep(index, {
        imageFile: file,
        imagePreview: reader.result as string,
        removeImage: false,
      });
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveImage(index: number) {
    updateStep(index, {
      imageFile: null,
      imagePreview: null,
      removeImage: true,
    });
  }

  return (
    <form action={formAction} className="mx-auto max-w-3xl space-y-6">
      <FormError message={state.error} />

      {/* Module info */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Module details</h3>

        <FormField label="Title" htmlFor="title" required>
          <Input
            id="title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Kitchen Deep Clean SOP"
            maxLength={200}
          />
        </FormField>

        <FormField
          label="Description"
          htmlFor="description"
          hint="Brief summary shown to employees before they start"
        >
          <Textarea
            id="description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this module covers…"
            rows={2}
          />
        </FormField>

        {/* Who is this for — combinatory account levels. Auto-assign and
            the admin rosters both filter by this. */}
        <div>
          <p className="text-sm font-medium">Who is this for?</p>
          <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
            Pick every level this module applies to — each level only ever
            sees its own modules.
          </p>
          <div className="space-y-1.5">
            {AUDIENCE_LEVELS.map((level) => (
              <label
                key={level.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <input
                  type="checkbox"
                  name="audience_levels"
                  value={level.value}
                  checked={audience.has(level.value)}
                  onChange={() => toggleAudience(level.value)}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-xs leading-relaxed">
                  <span className="font-medium">{level.label}</span>
                  <span className="block text-muted-foreground">
                    {level.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {audience.size === 0 && (
            <p className="mt-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              Pick at least one level — a module for nobody helps nobody.
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-muted/20 px-3 py-2.5">
          <input
            type="checkbox"
            name="assign_on_join"
            value="1"
            checked={assignOnJoin}
            onChange={(e) => setAssignOnJoin(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-xs leading-relaxed">
            <span className="font-medium">
              Assign to every new hire automatically
            </span>
            <span className="block text-muted-foreground">
              The moment someone at one of the levels above joins, this
              module lands on their training list — no one has to remember.
              Applies while the module is published.
            </span>
          </span>
        </label>
      </div>

      {/* Sections / Steps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Sections ({steps.length})
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addStep}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add section
          </Button>
        </div>

        {steps.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
            No sections yet. Click &quot;Add section&quot; to start building.
          </div>
        )}

        {steps.map((step, idx) => (
          <StepEditor
            key={step.key}
            index={idx}
            step={step}
            total={steps.length}
            onUpdate={(updates) => updateStep(idx, updates)}
            onRemove={() => removeStep(idx)}
            onMove={(dir) => moveStep(idx, dir)}
            onImageChange={(file) => handleImageChange(idx, file)}
            onRemoveImage={() => handleRemoveImage(idx)}
          />
        ))}

        {steps.length > 0 && (
          <button
            type="button"
            onClick={addStep}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card py-3 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another section
          </button>
        )}
      </div>

      {/* Hidden fields for step data */}
      {steps.map((step, idx) => (
        <div key={step.key}>
          <input type="hidden" name={`step_${idx}_title`} value={step.title} />
          <input type="hidden" name={`step_${idx}_body`} value={step.body} />
          <input
            type="hidden"
            name={`step_${idx}_existing_image`}
            value={step.existingImageUrl ?? ""}
          />
          <input
            type="hidden"
            name={`step_${idx}_remove_image`}
            value={step.removeImage ? "1" : "0"}
          />
          <input type="hidden" name={`step_${idx}_link`} value={step.linkUrl} />
        </div>
      ))}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="submit"
          name="status"
          value="published"
          disabled={pending}
          className="flex-1"
        >
          {pending ? "Saving…" : mode === "edit" ? "Save & publish" : "Save & publish"}
        </Button>
        <Button
          type="submit"
          name="status"
          value="draft"
          variant="outline"
          disabled={pending}
          className="flex-1"
        >
          {pending ? "Saving…" : "Save as draft"}
        </Button>
      </div>
    </form>
  );
}

// ── Step Editor ─────────────────────────────────────────────────

function StepEditor({
  index,
  step,
  total,
  onUpdate,
  onRemove,
  onMove,
  onImageChange,
  onRemoveImage,
}: {
  index: number;
  step: StepData;
  total: number;
  onUpdate: (updates: Partial<StepData>) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
  onImageChange: (file: File) => void;
  onRemoveImage: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Section {index + 1}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={index === 0}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={index === total - 1}
            className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-muted-foreground hover:text-red-500 transition-colors ml-1"
            title="Remove section"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Section title */}
        <div>
          <label
            htmlFor={`step-title-${index}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Section title
          </label>
          <Input
            id={`step-title-${index}`}
            value={step.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="e.g. Degrease the stovetop"
            className="mt-1"
          />
        </div>

        {/* Section body */}
        <div>
          <label
            htmlFor={`step-body-${index}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Instructions
          </label>
          <Textarea
            id={`step-body-${index}`}
            value={step.body}
            onChange={(e) => onUpdate({ body: e.target.value })}
            placeholder="Describe what the employee should do…"
            rows={3}
            className="mt-1"
          />
        </div>

        {/* Link — a video, a doc, a page. YouTube/Vimeo play inline in the
            field app; anything else opens in a new tab. */}
        <div>
          <label
            htmlFor={`step-link-${index}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Link <span className="font-normal">(optional — a video, a document, a page)</span>
          </label>
          <input
            id={`step-link-${index}`}
            type="url"
            inputMode="url"
            value={step.linkUrl}
            onChange={(e) => onUpdate({ linkUrl: e.target.value })}
            placeholder="https://youtu.be/…"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            YouTube and Vimeo links play right in the step. Everything else
            opens in a new tab.
          </p>
        </div>

        {/* Reference image */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Reference image
          </label>
          <div className="mt-1">
            {step.imagePreview ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={step.imagePreview}
                  alt={`Section ${index + 1} reference`}
                  className="max-h-40 rounded-md border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={onRemoveImage}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
              >
                <ImagePlus className="h-4 w-4" />
                Add reference image
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              name={`step_${index}_image`}
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImageChange(file);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
