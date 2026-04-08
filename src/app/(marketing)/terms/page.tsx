import Link from "next/link";

export const metadata = { title: "Terms of Service" };

const LAST_UPDATED = "April 7, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back home
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">
        Terms of Service
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="prose prose-sm mt-8 max-w-none text-sm leading-7 text-foreground">
        <p>
          By creating an account on Sollos 3 you agree to these terms. They are
          intentionally short and written in plain English.
        </p>

        <h2 className="mt-8 text-base font-semibold">1. The service</h2>
        <p>
          Sollos 3 is a software-as-a-service product that helps cleaning
          companies run their operations. Features may evolve over time. We
          will give 30 days&rsquo; notice before removing functionality you
          rely on.
        </p>

        <h2 className="mt-8 text-base font-semibold">2. Your account</h2>
        <p>
          You are responsible for keeping your login credentials secure and for
          everything that happens under your account. Notify us immediately at{" "}
          <a href="mailto:security@sollos.app" className="underline">
            security@sollos.app
          </a>{" "}
          if you suspect compromise.
        </p>

        <h2 className="mt-8 text-base font-semibold">3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>Use Sollos 3 for anything illegal or to harm others.</li>
          <li>
            Attempt to access another customer&rsquo;s data or interfere with
            the service.
          </li>
          <li>
            Reverse engineer the platform, scrape it, or resell it without
            written permission.
          </li>
          <li>
            Upload content you do not have the rights to store or share.
          </li>
        </ul>

        <h2 className="mt-8 text-base font-semibold">4. Your data</h2>
        <p>
          You own the data you put into Sollos 3. We act as a processor on
          your behalf. See our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          for the details.
        </p>

        <h2 className="mt-8 text-base font-semibold">5. Fees</h2>
        <p>
          Subscription pricing is shown at sign-up and may change with 30
          days&rsquo; notice. Paid plans are billed monthly in advance and are
          non-refundable except where required by law.
        </p>

        <h2 className="mt-8 text-base font-semibold">6. Termination</h2>
        <p>
          You may cancel any time from settings. We may suspend or terminate
          accounts that violate these terms. On termination you can export
          your data for 30 days; after that it is permanently deleted.
        </p>

        <h2 className="mt-8 text-base font-semibold">
          7. Disclaimers and liability
        </h2>
        <p>
          The service is provided &ldquo;as is&rdquo;. To the maximum extent
          permitted by law, our aggregate liability under these terms is
          limited to the fees you paid us in the prior 12 months.
        </p>

        <h2 className="mt-8 text-base font-semibold">8. Changes</h2>
        <p>
          We may update these terms. Material changes will be announced by
          email and inside the product at least 30 days in advance.
        </p>

        <h2 className="mt-8 text-base font-semibold">9. Contact</h2>
        <p>
          Questions:{" "}
          <a href="mailto:legal@sollos.app" className="underline">
            legal@sollos.app
          </a>
          .
        </p>

        <p className="mt-10 text-xs text-muted-foreground">
          This is a stub agreement intended to give launch customers something
          to point at. Final language will be reviewed by counsel before any
          paying customer is onboarded.
        </p>
      </div>
    </main>
  );
}
