import Link from "next/link";
import {
  Lock,
  ShieldCheck,
  KeyRound,
  Database,
  Webhook,
  Gauge,
  FileLock,
  RefreshCw,
  Trash2,
  Globe2,
} from "lucide-react";

export const metadata = {
  title: "Security",
  description:
    "How Sollos protects your data: encryption, isolation, rate limiting, audit logging, and more.",
};

const LAST_UPDATED = "April 18, 2026";

type Item = {
  icon: typeof Lock;
  title: string;
  body: string;
};

const SAFEGUARDS: Item[] = [
  {
    icon: Database,
    title: "Tenant isolation enforced by the database",
    body: "Every domain table has an organization_id and Postgres row-level security (RLS) policies prevent cross-tenant reads and writes. Isolation is enforced at the database layer, not in application code — even a compromised service key can't leak one customer's data to another.",
  },
  {
    icon: Lock,
    title: "Encryption in transit and at rest",
    body: "All traffic is TLS 1.2+ (HTTPS everywhere). The database and file storage are encrypted at rest with AES-256 by default. Daily backups rotate on a 7-day cycle.",
  },
  {
    icon: KeyRound,
    title: "OAuth tokens wrapped with AES-256-GCM",
    body: "When you connect Stripe, Google Calendar, or Sage, the resulting access and refresh tokens are encrypted with a platform-held key before being written to the database. A leaked backup alone cannot act on your connected accounts.",
  },
  {
    icon: ShieldCheck,
    title: "Authentication with verified sessions",
    body: "Sessions are verified against Supabase Auth on every request using cryptographically signed claims — never just cookies. Passwords are hashed by Supabase (bcrypt). Optional leaked-password checking against HaveIBeenPwned (k-anonymity — no password ever leaves your browser).",
  },
  {
    icon: Webhook,
    title: "Webhook signatures + idempotency",
    body: "Every incoming Stripe webhook is verified against its secret and short-circuited if the event id has already been processed. Fake payment events or double-processing on retry are structurally impossible.",
  },
  {
    icon: Gauge,
    title: "Rate limiting on every public surface",
    body: "Public token URLs (invoices, reviews, freelancer claims, team invites) and auth endpoints are rate-limited per IP to defeat brute-force token enumeration and credential stuffing. A distributed Upstash Redis limiter covers every serverless instance.",
  },
  {
    icon: FileLock,
    title: "No card data on our servers",
    body: "All payment processing is handled by Stripe Checkout. Card numbers, CVCs, and bank account details never touch Sollos infrastructure. Our PCI obligation is the lightest tier (SAQ A).",
  },
  {
    icon: RefreshCw,
    title: "Append-only audit log",
    body: "Sensitive mutations (payroll runs, invoice voids, role changes, deletions) record an audit row with actor, action, and before/after snapshots. Owners and admins can browse the log in-product at Settings → Audit log.",
  },
  {
    icon: Trash2,
    title: "Self-serve export and erasure",
    body: "At any time, owners can download a single JSON bundle containing every row their organization owns, or schedule permanent deletion with a 30-day grace window. The grace window lets you recover mistakes — you can cancel deletion up to the last day. After the window elapses, every row and file is wiped and the organization record becomes a tombstone.",
  },
  {
    icon: Globe2,
    title: "Data residency and sub-processors",
    body: "Your data is hosted in Supabase (Postgres + Storage) and Vercel (edge). Transactional email goes through MailerSend; error reports through Sentry. See our Privacy Policy for the full sub-processor list and the data each one handles.",
  },
];

export default function SecurityPage() {
  return (
    <main className="sollos-wash relative min-h-screen">
      <div className="sollos-dots absolute inset-0" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-16">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; Back home
        </Link>

        <div className="mt-6">
          <span className="sollos-kicker">
            <ShieldCheck className="h-3.5 w-3.5" />
            Security
          </span>
        </div>

        <h1 className="mt-4 text-4xl font-bold tracking-tight sollos-hero">
          How Sollos protects your data
        </h1>
        <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
          We treat customer data as a liability — we collect the minimum
          needed to run the product and protect what we do collect with
          defenses at the database, network, and application layers. This
          page lists the concrete safeguards in place today.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>

        {/* Safeguards grid */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {SAFEGUARDS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      {item.title}
                    </h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Not-yet-certified note */}
        <section className="mt-12 rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">What we don&rsquo;t claim</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Sollos is not SOC 2 certified. We are not HIPAA covered. We do not
            yet offer a signed Data Processing Agreement for EU customers.
            These are on the roadmap as we scale, but we&rsquo;d rather be
            honest about it than claim what we haven&rsquo;t earned. If you
            need any of the above for a procurement review, email{" "}
            <a
              href="mailto:security@sollos3.com"
              className="underline underline-offset-2 text-foreground"
            >
              security@sollos3.com
            </a>
            .
          </p>
        </section>

        {/* Report a vulnerability */}
        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">Report a vulnerability</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Found a security issue? Please email{" "}
            <a
              href="mailto:security@sollos3.com"
              className="underline underline-offset-2 text-foreground"
            >
              security@sollos3.com
            </a>{" "}
            rather than opening a public issue. We reply within one business
            day and will work with you on coordinated disclosure.
          </p>
        </section>

        {/* Cross-link */}
        <p className="mt-8 text-xs text-muted-foreground">
          For the full list of sub-processors and data-processing details,
          see our{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-2 text-foreground"
          >
            Privacy Policy
          </Link>
          . For the legal agreement between you and us, see our{" "}
          <Link
            href="/terms"
            className="underline underline-offset-2 text-foreground"
          >
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
