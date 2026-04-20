import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
  description:
    "Sollos 3 privacy policy — what data we collect, how we use it, and how it's protected.",
};

const LAST_UPDATED = "April 18, 2026";

export default function PrivacyPage() {
  return (
    <main className="sollos-wash relative min-h-screen">
      <div className="sollos-dots absolute inset-0" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-3xl px-6 py-16">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; Back home
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-foreground">
          {/* Intro */}
          <p>
            Sollos 3 (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;)
            provides operations software for cleaning companies. This privacy
            policy describes what personal information we collect, how we use it,
            and the choices you have. We treat customer data as a liability — we
            collect the minimum needed to run the product and nothing more.
          </p>

          {/* What we collect */}
          <section>
            <h2 className="text-base font-semibold">1. What we collect</h2>
            <ul className="mt-3 ml-5 list-disc space-y-2">
              <li>
                <strong>Account data</strong> — your name, email address,
                password hash, and the organization name you choose during
                sign-up.
              </li>
              <li>
                <strong>Operational data</strong> — clients, bookings, invoices,
                estimates, employees, freelancer contacts, chat messages,
                timesheets, and other records you enter into the product.
              </li>
              <li>
                <strong>Field data</strong> — clock-in / clock-out timestamps
                and, with your consent, the GPS coordinates captured at clock-in
                for verification purposes.
              </li>
              <li>
                <strong>Payment data</strong> — when billing is enabled, payment
                information is collected and processed directly by Stripe. We do
                not store credit card numbers on our servers.
              </li>
              <li>
                <strong>Usage and diagnostic data</strong> — error reports and
                basic application performance metrics collected via Sentry. We do
                not use third-party analytics, advertising trackers, or cookies
                for profiling.
              </li>
            </ul>
          </section>

          {/* How we use it */}
          <section>
            <h2 className="text-base font-semibold">2. How we use your data</h2>
            <p className="mt-3">We use the information we collect to:</p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>Provide, maintain, and improve the Sollos 3 service.</li>
              <li>
                Authenticate your identity and enforce access controls within
                your organization.
              </li>
              <li>
                Send transactional emails (password resets, booking
                confirmations, invoice delivery).
              </li>
              <li>
                Send SMS notifications to freelancer contacts when a shift offer
                is broadcast (via Twilio, when enabled by the organization
                admin).
              </li>
              <li>Diagnose and fix bugs, outages, and performance issues.</li>
              <li>
                Comply with legal obligations and respond to lawful requests.
              </li>
            </ul>
            <p className="mt-3">
              <strong>
                We do not sell your data, share it with advertisers, or use it to
                train any machine learning model.
              </strong>
            </p>
          </section>

          {/* Google user data */}
          <section>
            <h2 className="text-base font-semibold">
              3. Google user data disclosure
            </h2>
            <p className="mt-3">
              Sollos 3 offers an optional Google Calendar integration. When you
              choose to connect your Google account, we request access to the
              following scopes:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                  calendar.events
                </code>{" "}
                — to read your existing Google Calendar events and display them
                alongside your Sollos 3 bookings, and to create calendar events
                for confirmed bookings.
              </li>
            </ul>
            <p className="mt-3">
              <strong>How we use Google Calendar data:</strong>
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                We read your calendar events to display them as an overlay in the
                Sollos 3 calendar view, so you can see personal and work events
                in one place.
              </li>
              <li>
                We create events in your Google Calendar when bookings are
                confirmed, so your schedule stays in sync.
              </li>
              <li>
                We store your Google OAuth refresh token (encrypted) in our
                database so the integration stays connected between sessions.
              </li>
            </ul>
            <p className="mt-3">
              <strong>What we do NOT do with Google data:</strong>
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                We do not share your Google Calendar data with any third party.
              </li>
              <li>
                We do not use your Google Calendar data for advertising,
                profiling, or any purpose other than the calendar sync feature
                described above.
              </li>
              <li>
                We do not store the contents of your Google Calendar events in
                our database — they are fetched in real time and displayed only
                during your active session.
              </li>
              <li>
                We do not transfer your Google data to any AI or machine learning
                model.
              </li>
            </ul>
            <p className="mt-3">
              You can disconnect Google Calendar at any time from{" "}
              <strong>Settings &rarr; Integrations</strong> in Sollos 3. When you
              disconnect, we immediately delete your stored OAuth tokens. Sollos
              3&rsquo;s use and transfer of information received from Google APIs
              adheres to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </section>

          {/* Data isolation */}
          <section>
            <h2 className="text-base font-semibold">4. Data isolation</h2>
            <p className="mt-3">
              Sollos 3 is a multi-tenant application. Each customer&rsquo;s data
              is logically isolated using Postgres row-level security (RLS)
              policies. Every database query is automatically scoped to your
              organization — it is not possible for one customer to access
              another customer&rsquo;s data through the application.
            </p>
          </section>

          {/* Sub-processors */}
          <section>
            <h2 className="text-base font-semibold">5. Sub-processors</h2>
            <p className="mt-3">
              We use the following third-party services to operate Sollos 3:
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-semibold">Provider</th>
                    <th className="py-2 pr-4 font-semibold">Purpose</th>
                    <th className="py-2 font-semibold">Data processed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="py-2 pr-4 font-medium">Supabase</td>
                    <td className="py-2 pr-4">Database, auth, file storage, realtime</td>
                    <td className="py-2">All operational data</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-medium">Vercel</td>
                    <td className="py-2 pr-4">Application hosting, edge network</td>
                    <td className="py-2">HTTP requests, server logs</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-medium">Sentry</td>
                    <td className="py-2 pr-4">Error tracking</td>
                    <td className="py-2">Stack traces, browser metadata</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-medium">Resend</td>
                    <td className="py-2 pr-4">Transactional email</td>
                    <td className="py-2">Recipient email, message content</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-medium">Stripe</td>
                    <td className="py-2 pr-4">Payment processing</td>
                    <td className="py-2">Payment details (PCI-compliant)</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-medium">Twilio</td>
                    <td className="py-2 pr-4">SMS delivery (freelancer bench)</td>
                    <td className="py-2">Phone numbers, message content</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-medium">Google</td>
                    <td className="py-2 pr-4">Calendar sync (optional)</td>
                    <td className="py-2">OAuth tokens, calendar event data</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Cookies */}
          <section>
            <h2 className="text-base font-semibold">6. Cookies</h2>
            <p className="mt-3">
              Sollos 3 uses only essential cookies required for authentication
              and session management. We do not use tracking cookies, advertising
              cookies, or any third-party cookie-based analytics.
            </p>
          </section>

          {/* Security safeguards */}
          <section>
            <h2 className="text-base font-semibold">
              7. Security safeguards
            </h2>
            <p className="mt-3">
              We protect your data with defenses at the database, network,
              and application layers:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                Tenant isolation enforced by Postgres row-level security — one
                customer&rsquo;s data cannot be read by another, even in the
                event of an application-layer bug.
              </li>
              <li>
                TLS 1.2+ in transit; AES-256 encryption at rest for database
                and file storage.
              </li>
              <li>
                Third-party OAuth tokens (Stripe, Google Calendar, Sage) are
                additionally encrypted with AES-256-GCM before storage using a
                platform-held key.
              </li>
              <li>
                Every Stripe webhook is cryptographically signature-verified
                and idempotently deduplicated.
              </li>
              <li>
                Rate limiting on every public token URL and auth endpoint to
                prevent brute-force enumeration and credential stuffing.
              </li>
              <li>
                Payment card data never touches our servers — Stripe Checkout
                handles all card processing.
              </li>
              <li>
                Append-only audit log of sensitive mutations (payroll, invoice
                voids, role changes, deletions).
              </li>
            </ul>
            <p className="mt-3">
              The full list of safeguards, including what we don&rsquo;t yet
              claim (e.g. SOC 2 certification), is maintained on our{" "}
              <Link
                href="/security"
                className="underline underline-offset-2"
              >
                Security page
              </Link>
              .
            </p>
          </section>

          {/* Retention */}
          <section>
            <h2 className="text-base font-semibold">8. Data retention</h2>
            <p className="mt-3">
              Customer data is retained for the life of the account. When an
              organization owner schedules deletion from{" "}
              <strong>Settings &rarr; Your data</strong>, the account enters a
              30-day grace window during which the owner can cancel with zero
              data loss. After the window elapses, every row and file is
              permanently wiped and the organization record becomes a
              tombstone (retained only to prevent id reuse). Daily database
              backups rotate on a 7-day cycle.
            </p>
          </section>

          {/* Your rights */}
          <section>
            <h2 className="text-base font-semibold">9. Your rights</h2>
            <p className="mt-3">
              Depending on your jurisdiction, you may have the right to:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>Access a copy of the personal data we hold about you.</li>
              <li>Correct inaccurate personal data.</li>
              <li>
                Request deletion of your data (subject to legal retention
                requirements).
              </li>
              <li>Object to or restrict certain processing activities.</li>
              <li>
                Export your data in a structured, machine-readable format.
              </li>
            </ul>
            <p className="mt-3">
              Organization owners can self-serve both export and deletion from{" "}
              <strong>Settings &rarr; Your data</strong> in the Sollos app —
              no email required. The export produces a single JSON bundle
              containing every row your organization owns. Deletion uses the
              30-day grace window described above. For any right not covered
              by the self-serve UI, or if you are a client or employee
              contacting us about data held by a Sollos customer, email{" "}
              <a
                href="mailto:privacy@sollos3.com"
                className="underline underline-offset-2"
              >
                privacy@sollos3.com
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          {/* Children */}
          <section>
            <h2 className="text-base font-semibold">
              10. Children&rsquo;s privacy
            </h2>
            <p className="mt-3">
              Sollos 3 is a business-to-business product. We do not knowingly
              collect personal information from anyone under the age of 16. If we
              learn that we have collected data from a child, we will delete it
              promptly.
            </p>
          </section>

          {/* Changes */}
          <section>
            <h2 className="text-base font-semibold">11. Changes to this policy</h2>
            <p className="mt-3">
              We may update this privacy policy from time to time. Material
              changes will be announced by email and inside the product at least
              30 days before they take effect. The &ldquo;last updated&rdquo;
              date at the top of this page reflects the most recent revision.
            </p>
          </section>

          {/* Contact */}
          <section>
            <h2 className="text-base font-semibold">12. Contact us</h2>
            <p className="mt-3">
              If you have questions about this privacy policy or our data
              practices, contact us at:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                Email:{" "}
                <a
                  href="mailto:privacy@sollos3.com"
                  className="underline underline-offset-2"
                >
                  privacy@sollos3.com
                </a>
              </li>
              <li>
                Website:{" "}
                <a
                  href="https://sollos3.com"
                  className="underline underline-offset-2"
                >
                  sollos3.com
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
