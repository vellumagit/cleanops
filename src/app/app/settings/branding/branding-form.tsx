"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, Check } from "lucide-react";
import { SetupReturnField } from "@/components/setup-return-field";
import { saveBrandingAction, type BrandingFormState } from "./actions";

const initialState: BrandingFormState = {};

const PRESET_COLORS = [
  { hex: "4f46e5", label: "Indigo" },
  { hex: "0891b2", label: "Cyan" },
  { hex: "059669", label: "Emerald" },
  { hex: "d97706", label: "Amber" },
  { hex: "dc2626", label: "Red" },
  { hex: "7c3aed", label: "Violet" },
  { hex: "0f172a", label: "Slate" },
  { hex: "1d4ed8", label: "Blue" },
];

export function BrandingForm({
  organizationId,
  currentLogoUrl,
  currentBrandColor,
  orgName,
}: {
  organizationId: string;
  currentLogoUrl: string | null;
  currentBrandColor: string | null;
  orgName: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveBrandingAction,
    initialState,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl);
  const [removeFlag, setRemoveFlag] = useState(false);
  const [selectedColor, setSelectedColor] = useState(
    currentBrandColor ?? "",
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemoveFlag(false);
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    setPreviewUrl(null);
    setRemoveFlag(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form action={formAction} className="mx-auto max-w-2xl space-y-8">
      <SetupReturnField />
      {state.errors?._form && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {state.errors._form}
        </div>
      )}

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          Branding updated.
        </div>
      )}

      {/* Logo section */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Company logo</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Appears on invoices, public links, and the field app. PNG, JPEG,
          WebP, or SVG. Max 2 MB.
        </p>

        <div className="mt-4 flex items-start gap-5">
          {/* Preview */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={`${orgName} logo`}
                className="h-full w-full object-contain p-1"
              />
            ) : (
              <span className="text-2xl font-bold text-muted-foreground/30">
                {orgName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {previewUrl ? "Replace" : "Upload"}
              </Button>
              {previewUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveLogo}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleFileChange}
            />
            {state.errors?.logo && (
              <p className="text-xs text-destructive">{state.errors.logo}</p>
            )}
          </div>
        </div>

        <input type="hidden" name="remove_logo" value={removeFlag ? "1" : "0"} />
      </div>

      {/* Brand colour section */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">Brand colour</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your primary colour. Used as the accent on invoices, public pages,
          and the sidebar active link.
        </p>

        <div className="mt-4 space-y-3">
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.label}
                onClick={() => setSelectedColor(c.hex)}
                className="group relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all"
                style={{
                  backgroundColor: `#${c.hex}`,
                  borderColor:
                    selectedColor === c.hex
                      ? `#${c.hex}`
                      : "transparent",
                  boxShadow:
                    selectedColor === c.hex
                      ? `0 0 0 2px white, 0 0 0 4px #${c.hex}`
                      : "none",
                }}
              >
                {selectedColor === c.hex && (
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                )}
              </button>
            ))}
          </div>

          {/* Custom hex input */}
          <div className="flex items-center gap-2">
            {selectedColor && /^[0-9a-fA-F]{6}$/.test(selectedColor) ? (
              <div
                className="h-8 w-8 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: `#${selectedColor}` }}
                aria-label="Current brand colour"
              />
            ) : (
              // Empty / invalid hex — render an obviously "unset" state
              // (dashed border, no fill) instead of a solid grey that can
              // read as "your brand colour IS grey".
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 text-[11px] text-muted-foreground/50"
                aria-label="No brand colour selected yet"
              >
                —
              </div>
            )}
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                #
              </span>
              <Input
                name="brand_color"
                type="text"
                maxLength={6}
                value={selectedColor}
                onChange={(e) =>
                  setSelectedColor(e.target.value.replace(/[^0-9a-fA-F]/g, ""))
                }
                className="pl-7 font-mono uppercase"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pick a preset above or enter a 6-digit hex value.
          </p>
          {state.errors?.brand_color && (
            <p className="text-xs text-destructive">
              {state.errors.brand_color}
            </p>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold">Preview</h3>
        <div className="rounded-lg border border-border bg-muted/20 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Logo preview"
                  className="h-full w-full object-contain p-0.5"
                />
              ) : (
                <span className="text-lg font-bold text-muted-foreground/30">
                  {orgName.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{orgName}</p>
              <p className="text-xs text-muted-foreground">
                Invoice #INV-001
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <div
              className="rounded-md px-4 py-1.5 text-xs font-semibold text-white"
              style={{
                backgroundColor: selectedColor
                  ? `#${selectedColor}`
                  : "#6366f1",
              }}
            >
              Pay now
            </div>
            <div
              className="rounded-md border px-4 py-1.5 text-xs font-semibold"
              style={{
                borderColor: selectedColor
                  ? `#${selectedColor}`
                  : "#6366f1",
                color: selectedColor ? `#${selectedColor}` : "#6366f1",
              }}
            >
              Download PDF
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          This is how your brand will appear on invoices and public links.
        </p>
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving..." : "Save branding"}
      </Button>
    </form>
  );
}
