/**
 * Sollos 3 — full-screen boot splash.
 *
 * Cinematic "rock and roll" loading screen used by every top-level
 * segment's `loading.tsx`. Pure CSS + a single string of JSX so it
 * renders on the very first paint, before any client bundle hydrates.
 *
 * Layered effects:
 *   1. Radial stage background with a slowly rotating indigo aura
 *   2. A masked dot grid overlay for texture
 *   3. An "S3" glow halo that pulses behind the word mark
 *   4. The "Sollos 3" word mark with an entrance rise, continuous
 *      gradient shimmer, and a subtle neon flicker
 *   5. An animated loading bar with a white-hot highlight sweep
 *   6. A "Powered by Velluma" footer that fades in last
 *
 * All animations short-circuit under `prefers-reduced-motion: reduce`.
 */

type Props = {
  /**
   * Small uppercase tagline shown under the word mark. Defaults to the
   * product descriptor. Pass something contextual on sub-routes if you want
   * e.g. "Loading your workspace…" on /app.
   */
  tagline?: string;
};

export function SollosLoader({
  tagline = "Operations · Cleaning · Field",
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Sollos 3"
      className="sollos-loader"
    >
      {/* Logo with halo */}
      <div className="relative flex items-center justify-center">
        <span className="sollos-loader-halo" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sollos-logo.png"
          alt="Sollos 3"
          className="sollos-loader-logo"
        />
      </div>

      {/* Product tagline */}
      <span className="sollos-loader-tagline">{tagline}</span>

      {/* Animated bar */}
      <div className="sollos-loader-bar" aria-hidden />

      {/* Powered by Velluma */}
      <div className="sollos-loader-footer">
        <span className="sollos-loader-footer-label">Powered by</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/velluma-logo.png"
          alt="Velluma"
          className="sollos-loader-velluma-logo"
        />
      </div>

      <span className="sr-only">Loading Sollos 3…</span>
    </div>
  );
}
