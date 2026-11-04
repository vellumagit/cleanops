import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUsPhone, loadTextingPolicyBusiness } from "../policy";

/**
 * A business's texting terms, hosted by Sollos for the same reason as the
 * privacy page: carriers require a public terms page that names the
 * program, its frequency, rates, and how to stop and get help.
 */
export async function generateMetadata({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const b = await loadTextingPolicyBusiness(orgId);
  return { title: b ? `${b.name} — Text message terms` : "Terms", robots: { index: false } };
}

export default async function TextingTermsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const b = await loadTextingPolicyBusiness(orgId);
  if (!b) notFound();
  const phone = formatUsPhone(b.phone);
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="text-2xl font-semibold">{b.name}: text message terms</h1>
      <h2 className="text-base font-semibold">The program</h2>
      <p>
        {b.name} appointment texts: booking confirmations, a reminder the day before a visit, notices when a visit is
        rescheduled or cancelled, and invoices and payment receipts. No marketing.
      </p>
      <h2 className="text-base font-semibold">Signing up</h2>
      <p>
        You receive these texts only after agreeing to them: by replying YES to our consent request, by texting START
        to our number, or by telling us in person, which we record.
      </p>
      <h2 className="text-base font-semibold">Frequency and cost</h2>
      <p>Message frequency varies with your bookings. Message and data rates may apply.</p>
      <h2 className="text-base font-semibold">Stopping and help</h2>
      <p>
        Reply STOP to stop all texts at once; you&apos;ll get one message confirming it. Reply START to resume. Reply
        HELP for help, or contact {b.name}
        {phone ? ` at ${phone}` : ""}
        {b.email ? ` or ${b.email}` : ""}.
      </p>
      <h2 className="text-base font-semibold">Carriers</h2>
      <p>Carriers are not liable for delayed or undelivered messages.</p>
      <h2 className="text-base font-semibold">Privacy</h2>
      <p>
        See our{" "}
        <Link href={`/texting/${orgId}/privacy`} className="underline underline-offset-2">
          text message privacy policy
        </Link>
        .
      </p>
    </main>
  );
}
