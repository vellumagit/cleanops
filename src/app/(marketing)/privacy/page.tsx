import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

const LAST_UPDATED = "April 7, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back home
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="prose prose-sm mt-8 max-w-none text-sm leading-7 text-foreground">
        <p>
          CleanOps (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides operations
          software for cleaning companies. This policy describes what we
          collect, why, and how it&rsquo;s protected. We treat customer data as
          a liability — we collect the minimum needed to run the product.
        </p>

        <h2 className="mt-8 text-base font-semibold">What we collect</h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Account data</strong> — name, email, password hash,
            organization name.
          </li>
          <li>
            <strong>Operational data</strong> — clients, bookings, employees,
            invoices and related records that customers enter into the product.
          </li>
          <li>
            <strong>Field data</strong> — clock-in / clock-out timestamps and
            (with consent) the geolocation captured at clock-in.
          </li>
          <li>
            <strong>Telemetry</strong> — error reports and basic uptime metrics
            via Sentry. No third-party analytics or ad trackers.
          </li>
        </ul>

        <h2 className="mt-8 text-base font-semibold">How we use it</h2>
        <p>
          To run the product. We do not sell data, share it with advertisers,
          or use it to train any model. Each customer&rsquo;s data is isolated
          in their own tenant via Postgres row-level security.
        </p>

        <h2 className="mt-8 text-base font-semibold">Sub-processors</h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Supabase</strong> — primary database, authentication, file
            storage and realtime delivery.
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and edge network.
          </li>
          <li>
            <strong>Sentry</strong> — error tracking.
          </li>
          <li>
            <strong>Resend</strong> — transactional email.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing (when billing is
            enabled).
          </li>
        </ul>

        <h2 className="mt-8 text-base font-semibold">Retention</h2>
        <p>
          Customer data is retained for the life of the account. Deleting your
          organization purges all associated rows within 30 days. Daily backups
          rotate on a 7-day cycle.
        </p>

        <h2 className="mt-8 text-base font-semibold">Your rights</h2>
        <p>
          You may request a copy of, correction of, or deletion of your data
          at any time by emailing{" "}
          <a href="mailto:privacy@cleanops.app" className="underline">
            privacy@cleanops.app
          </a>
          .
        </p>

        <h2 className="mt-8 text-base font-semibold">Contact</h2>
        <p>
          Questions about this policy:{" "}
          <a href="mailto:privacy@cleanops.app" className="underline">
            privacy@cleanops.app
          </a>
          .
        </p>

        <p className="mt-10 text-xs text-muted-foreground">
          This is a stub policy intended to give launch customers something to
          point at. Final language will be reviewed by counsel before any
          paying customer is onboarded.
        </p>
      </div>
    </main>
  );
}
