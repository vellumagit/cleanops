/**
 * Browser-side instrumentation.
 *
 * Initializes Sentry in the browser when NEXT_PUBLIC_SENTRY_DSN is set.
 * Without a DSN this is a no-op and Sentry is never imported.
 *
 * Also exports `onRouterTransitionStart` so Sentry sees client-side
 * navigations as breadcrumbs on any captured error.
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV ??
      "development",
    tracesSampleRate: 0.1,
    // Session replay — off by default; flip to a low rate once DSN is live
    // and you've confirmed PII masking config in the Sentry dashboard.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
