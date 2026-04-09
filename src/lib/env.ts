/**
 * Zod-validated environment configuration.
 *
 * All env-var lookups in server code should go through this module so that:
 *
 *   1. Missing required secrets fail fast at boot (not at the moment a
 *      webhook fires or a user clicks "Connect Stripe") with a readable
 *      error message.
 *   2. TypeScript knows which vars exist and their shape — no more
 *      `process.env.FOO ?? ""` scattered through the codebase.
 *   3. Optional integrations can be probed with a simple
 *      `isStripeConfigured()` style helper instead of re-checking raw
 *      env vars everywhere.
 *
 * Runtime philosophy: BASE vars (Supabase, site URL) are required and we
 * throw if they're missing. INTEGRATION vars (Stripe/Square/QBO/Twilio
 * /Resend/Sentry/encryption key) are optional — the code path gates on
 * them individually. That means the app boots cleanly in dev even with
 * an empty .env.local, and each integration lights up as its keys land.
 */

import "server-only";
import { z } from "zod";

const BaseSchema = z.object({
  // Core — must be present or the whole app is broken.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),

  // Optional — every integration below follows the "all-or-none" rule:
  // either the full bundle is present or the feature is off.

  // Twilio (Phase 11, freelancer bench)
  TWILIO_ENABLED: z.enum(["true", "false"]).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Resend (transactional email)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Sentry
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),

  // Stripe platform billing (Phase 10 — Sollos 3 → platform subscriptions)
  STRIPE_ENABLED: z.enum(["true", "false"]).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // -- Phase 12 — Invoicing integrations -------------------------------------

  // Symmetric key for encrypting OAuth tokens at rest. Required as soon as
  // ANY of the three providers below is configured, but we don't enforce
  // that here — src/lib/crypto.ts throws at first use if missing.
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),

  // Stripe Connect (Standard) — for collecting payments on behalf of users
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),

  // Square
  SQUARE_APPLICATION_ID: z.string().optional(),
  SQUARE_APPLICATION_SECRET: z.string().optional(),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),
  SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),

  // QuickBooks Online (Intuit)
  QUICKBOOKS_CLIENT_ID: z.string().optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional(),
  QUICKBOOKS_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
});

type Env = z.infer<typeof BaseSchema>;

let cached: Env | null = null;

/**
 * Return the parsed environment. Throws a readable error on first call
 * if required vars are missing.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = BaseSchema.safeParse(process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const msg = Object.entries(flat)
      .map(([k, v]) => `  - ${k}: ${(v ?? []).join(", ")}`)
      .join("\n");
    throw new Error(
      "Invalid environment configuration. The following vars failed validation:\n" +
        msg +
        "\n\nCheck your .env.local (or Vercel project env vars).",
    );
  }
  cached = parsed.data;
  return cached;
}

// -----------------------------------------------------------------------------
// Feature flags — cheap boolean checks for UI + action gating.
// -----------------------------------------------------------------------------

export function isStripePlatformConfigured(): boolean {
  const e = getEnv();
  return (
    e.STRIPE_ENABLED === "true" &&
    !!e.STRIPE_SECRET_KEY &&
    !!e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  );
}

/** Stripe Connect (for invoicing, not platform billing). */
export function isStripeConnectConfigured(): boolean {
  const e = getEnv();
  return (
    !!e.STRIPE_SECRET_KEY &&
    !!e.STRIPE_CONNECT_CLIENT_ID &&
    !!e.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
    !!e.INTEGRATION_ENCRYPTION_KEY
  );
}

export function isSquareConfigured(): boolean {
  const e = getEnv();
  return (
    !!e.SQUARE_APPLICATION_ID &&
    !!e.SQUARE_APPLICATION_SECRET &&
    !!e.SQUARE_ENVIRONMENT &&
    !!e.INTEGRATION_ENCRYPTION_KEY
  );
}

export function isQuickBooksConfigured(): boolean {
  const e = getEnv();
  return (
    !!e.QUICKBOOKS_CLIENT_ID &&
    !!e.QUICKBOOKS_CLIENT_SECRET &&
    !!e.QUICKBOOKS_ENVIRONMENT &&
    !!e.INTEGRATION_ENCRYPTION_KEY
  );
}

export function isTwilioConfigured(): boolean {
  const e = getEnv();
  return (
    e.TWILIO_ENABLED === "true" &&
    !!e.TWILIO_ACCOUNT_SID &&
    !!e.TWILIO_AUTH_TOKEN &&
    !!e.TWILIO_FROM_NUMBER
  );
}

export function isResendConfigured(): boolean {
  return !!getEnv().RESEND_API_KEY;
}
