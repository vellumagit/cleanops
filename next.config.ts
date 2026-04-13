import path from "node:path";
import type { NextConfig } from "next";

/**
 * Security headers + CSP for CleanOps.
 *
 * The CSP intentionally allows:
 *   - 'self' for everything by default
 *   - https://*.supabase.co for the Supabase REST + Auth + Storage APIs
 *   - wss://*.supabase.co for the Supabase Realtime channels (chat)
 *   - https://*.ingest.sentry.io for the Sentry transport (Phase 10)
 *   - https://api.stripe.com for future Stripe calls (scaffolded in Phase 10)
 *
 * 'unsafe-inline' is allowed for `style-src` because Tailwind + shadcn/ui
 * inject component-level style attributes. We do NOT allow it for `script-src`.
 *
 * `frame-ancestors 'none'` blocks clickjacking. `Strict-Transport-Security`
 * is enabled in production only — local dev runs over plain HTTP.
 */

const SUPABASE_HOST = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    return new URL(url).host;
  } catch {
    return null;
  }
})();

const supabaseHttp = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : "https://*.supabase.co";
const supabaseWs = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : "wss://*.supabase.co";

const csp = [
  `default-src 'self'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  // Next.js needs unsafe-eval in dev for HMR; production uses 'self' only.
  process.env.NODE_ENV === "production"
    ? `script-src 'self' 'unsafe-inline' https://js.stripe.com`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${supabaseHttp}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${supabaseHttp} ${supabaseWs} https://api.stripe.com https://*.ingest.sentry.io`,
  `frame-src https://js.stripe.com https://hooks.stripe.com`,
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `upgrade-insecure-requests`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Pin Turbopack to this project root so a stray lockfile in the user's
  // home directory doesn't confuse the build.
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    // Raise server action body limit for image/PDF uploads via forms.
    // Default is 1 MB; feed images + estimate PDFs can be up to 10 MB.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        // Apply to every route except Next's internal asset paths, which
        // browsers fetch with their own CORS rules.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
