import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
  description:
    "Sollos 3 terms of service — the agreement between you and Sollos 3.",
};

const LAST_UPDATED = "April 18, 2026";

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="mt-8 space-y-8 text-sm leading-7 text-foreground">
          {/* Intro */}
          <p>
            These terms of service (&ldquo;Terms&rdquo;) govern your use of
            Sollos 3, a software-as-a-service product operated by Sollos 3
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By
            creating an account or using the service, you agree to be bound by
            these Terms. If you do not agree, do not use the service.
          </p>

          {/* 1. The service */}
          <section>
            <h2 className="text-base font-semibold">1. The service</h2>
            <p className="mt-3">
              Sollos 3 is operations software designed for cleaning companies. It
              provides booking and scheduling, team management, invoicing,
              real-time communication, field tools, and related functionality.
              Features may evolve over time. We will give at least 30
              days&rsquo; notice before removing functionality that you actively
              rely on.
            </p>
          </section>

          {/* 2. Eligibility */}
          <section>
            <h2 className="text-base font-semibold">2. Eligibility</h2>
            <p className="mt-3">
              You must be at least 16 years old and have the legal capacity to
              enter into a binding agreement to use Sollos 3. If you are using
              the service on behalf of a company or organization, you represent
              that you have authority to bind that entity to these Terms.
            </p>
          </section>

          {/* 3. Your account */}
          <section>
            <h2 className="text-base font-semibold">3. Your account</h2>
            <p className="mt-3">
              You are responsible for keeping your login credentials secure and
              for all activity that occurs under your account. You must:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>Use a strong, unique password.</li>
              <li>
                Notify us immediately at{" "}
                <a
                  href="mailto:security@sollos3.com"
                  className="underline underline-offset-2"
                >
                  security@sollos3.com
                </a>{" "}
                if you suspect unauthorized access.
              </li>
              <li>Not share account credentials with unauthorized parties.</li>
            </ul>
          </section>

          {/* 4. Acceptable use */}
          <section>
            <h2 className="text-base font-semibold">4. Acceptable use</h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                Use Sollos 3 for any purpose that is illegal or harmful to
                others.
              </li>
              <li>
                Attempt to access another customer&rsquo;s data or interfere
                with the service&rsquo;s operation.
              </li>
              <li>
                Reverse-engineer, decompile, scrape, or resell the platform
                without our written permission.
              </li>
              <li>
                Upload content you do not have the rights to store or share.
              </li>
              <li>
                Use automated scripts, bots, or crawlers to access the service
                without authorization.
              </li>
              <li>
                Send spam, unsolicited messages, or misleading content through
                the service.
              </li>
            </ul>
          </section>

          {/* 5. Your data */}
          <section>
            <h2 className="text-base font-semibold">5. Your data</h2>
            <p className="mt-3">
              You retain ownership of all data you enter into Sollos 3. We act
              as a data processor on your behalf. We will not access, use, or
              share your data except as necessary to operate the service, comply
              with the law, or as described in our{" "}
              <Link href="/privacy" className="underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </p>
            <p className="mt-3">
              You are responsible for ensuring that your use of Sollos 3
              complies with all applicable data protection laws, including
              obtaining any necessary consents from your employees and clients
              whose data you enter into the platform.
            </p>
          </section>

          {/* 6. Third-party integrations */}
          <section>
            <h2 className="text-base font-semibold">
              6. Third-party integrations
            </h2>
            <p className="mt-3">
              Sollos 3 offers optional integrations with third-party services
              such as Google Calendar, Stripe, and Twilio. When you enable an
              integration:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                You authorize us to exchange data with the third-party service
                as needed to operate the integration.
              </li>
              <li>
                Your use of the third-party service is subject to that
                service&rsquo;s own terms and privacy policy.
              </li>
              <li>
                You may disconnect any integration at any time from your
                account settings.
              </li>
            </ul>
          </section>

          {/* 7. Fees and billing */}
          <section>
            <h2 className="text-base font-semibold">7. Fees and billing</h2>
            <p className="mt-3">
              Subscription pricing is displayed at sign-up and on our website.
              Prices may change with at least 30 days&rsquo; advance notice.
              Paid plans are billed monthly in advance. Payments are processed
              by Stripe and are non-refundable except where required by
              applicable law.
            </p>
            <p className="mt-3">
              New accounts include a 14-day free trial. No credit card is
              required to start the trial. You may cancel at any time before
              the trial ends to avoid being charged. At the end of the trial,
              if you have not selected a paid plan, account access is
              restricted to read-only until a plan is selected; your data is
              retained.
            </p>
            <p className="mt-3">
              If payment fails, we will attempt to collect for up to 14 days
              before suspending your account. Your data will be retained for 30
              days after suspension, after which it may be permanently deleted.
            </p>
          </section>

          {/* 8. Service availability */}
          <section>
            <h2 className="text-base font-semibold">8. Service availability</h2>
            <p className="mt-3">
              We aim for 99.9% uptime but do not guarantee uninterrupted
              access. We may perform scheduled maintenance with reasonable
              advance notice. We are not liable for downtime caused by
              circumstances beyond our reasonable control, including third-party
              service outages, natural disasters, or cyberattacks.
            </p>
          </section>

          {/* 9. Intellectual property */}
          <section>
            <h2 className="text-base font-semibold">9. Intellectual property</h2>
            <p className="mt-3">
              The Sollos 3 service, including its software, design, logos, and
              documentation, is our intellectual property. These Terms do not
              grant you any right to use our branding or trademarks. You retain
              all rights to your data.
            </p>
          </section>

          {/* 10. Termination */}
          <section>
            <h2 className="text-base font-semibold">10. Termination</h2>
            <p className="mt-3">
              <strong>By you:</strong> You may cancel your account at any time
              from Settings. Upon cancellation, you can export your data for 30
              days. After 30 days, all data associated with your organization is
              permanently deleted.
            </p>
            <p className="mt-3">
              <strong>By us:</strong> We may suspend or terminate your account
              if you violate these Terms, if your payment is overdue for more
              than 14 days, or if required by law. We will provide reasonable
              notice where possible.
            </p>
          </section>

          {/* 11. Disclaimers */}
          <section>
            <h2 className="text-base font-semibold">
              11. Disclaimers and limitation of liability
            </h2>
            <p className="mt-3">
              The service is provided &ldquo;as is&rdquo; and &ldquo;as
              available&rdquo; without warranties of any kind, express or
              implied, including but not limited to implied warranties of
              merchantability, fitness for a particular purpose, and
              non-infringement.
            </p>
            <p className="mt-3">
              To the maximum extent permitted by law, our aggregate liability
              under these Terms is limited to the total fees you paid us in the
              12 months preceding the claim. We are not liable for any indirect,
              incidental, special, consequential, or punitive damages.
            </p>
          </section>

          {/* 12. Indemnification */}
          <section>
            <h2 className="text-base font-semibold">12. Indemnification</h2>
            <p className="mt-3">
              You agree to indemnify and hold us harmless from any claims,
              damages, or expenses arising from your use of the service, your
              violation of these Terms, or your violation of any third-party
              rights.
            </p>
          </section>

          {/* 13. Governing law */}
          <section>
            <h2 className="text-base font-semibold">13. Governing law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of the Province of Ontario,
              Canada, and the federal laws of Canada applicable therein, without
              regard to conflict-of-law principles. You and Sollos 3 submit to
              the exclusive jurisdiction of the courts located in Toronto,
              Ontario for any dispute arising out of or relating to these Terms,
              except that either party may seek injunctive relief in any court
              of competent jurisdiction to protect its intellectual property.
            </p>
          </section>

          {/* 14. Changes */}
          <section>
            <h2 className="text-base font-semibold">14. Changes to these terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. Material changes will
              be announced by email and inside the product at least 30 days
              before they take effect. Continued use of the service after
              changes take effect constitutes acceptance of the revised Terms.
            </p>
          </section>

          {/* 15. Contact */}
          <section>
            <h2 className="text-base font-semibold">15. Contact</h2>
            <p className="mt-3">
              If you have questions about these Terms, contact us at:
            </p>
            <ul className="mt-2 ml-5 list-disc space-y-1">
              <li>
                General:{" "}
                <a
                  href="mailto:hello@sollos3.com"
                  className="underline underline-offset-2"
                >
                  hello@sollos3.com
                </a>
              </li>
              <li>
                Legal:{" "}
                <a
                  href="mailto:legal@sollos3.com"
                  className="underline underline-offset-2"
                >
                  legal@sollos3.com
                </a>
              </li>
              <li>
                Security:{" "}
                <a
                  href="mailto:security@sollos3.com"
                  className="underline underline-offset-2"
                >
                  security@sollos3.com
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
