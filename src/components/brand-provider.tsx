"use client";

/**
 * BrandProvider — injects the org's brand colour as CSS custom properties
 * on a wrapper <div> so every descendant can reference them:
 *
 *   --brand          → full hex   e.g. #4f46e5
 *   --brand-rgb      → R,G,B     e.g. 79,70,229  (for rgba())
 *   --brand-light    → 10% opacity tint
 *   --brand-lighter  → 5% opacity tint
 *
 * Falls back to the Sollos indigo (#6366f1) when no brand colour is set.
 */

const DEFAULT_BRAND = "6366f1";

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export function BrandProvider({
  brandColor,
  children,
  className,
}: {
  brandColor: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const hex = brandColor && /^[0-9a-fA-F]{6}$/.test(brandColor)
    ? brandColor
    : DEFAULT_BRAND;

  return (
    <div
      className={className}
      style={{
        "--brand": `#${hex}`,
        "--brand-rgb": hexToRgb(hex),
        "--brand-light": `rgba(${hexToRgb(hex)}, 0.10)`,
        "--brand-lighter": `rgba(${hexToRgb(hex)}, 0.05)`,
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
