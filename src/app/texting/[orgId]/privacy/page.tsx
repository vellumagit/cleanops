import { notFound } from "next/navigation";
import { formatUsPhone, loadTextingPolicyBusiness } from "../policy";

/**
 * A business's texting privacy policy, hosted by Sollos so a small company
 * without one can still register for US texting. Carriers reject a campaign
 * whose privacy policy is missing, behind a login, or silent on sharing
 * mobile numbers; this page is public and says it plainly.
 */
export async function generateMetadata({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const b = await loadTextingPolicyBusiness(orgId);
  return { title: b ? `${b.name} — Text message privacy policy` : "Privacy policy", robots: { index: false } };
}

export default async function TextingPrivacyPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const b = await loadTextingPolicyBusiness(orgId);
  if (!b) notFound();
  const phone = formatUsPhone(b.phone);
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="text-2xl font-semibold">{b.name}: text message privacy policy</h1>
      <p>
        This policy covers the text messages {b.name} sends about your cleaning appointments and your account. {b.name}{" "}
        sends them using Sollos, its scheduling software.
      </p>
      <h2 className="text-base font-semibold">What we collect</h2>
      <p>
        Your mobile phone number, your consent to receive texts (when and how you gave it), and the messages we
        exchange with you by text.
      </p>
      <h2 className="text-base font-semibold">How we use it</h2>
      <p>
        Only to send you messages about your service: booking confirmations, reminders, schedule changes, invoices and
        payment receipts, and replies to your questions. We do not send marketing texts.
      </p>
      <h2 className="text-base font-semibold">Sharing</h2>
      <p>
        No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.
        Text messaging opt-in data and consent are not shared with any third party. We share your number only with the
        service providers that deliver our messages (our scheduling software and its telecommunications carrier), and
        only to deliver them.
      </p>
      <h2 className="text-base font-semibold">Your choices</h2>
      <p>
        Message frequency varies with your bookings. Message and data rates may apply. Reply STOP at any time to stop
        all texts, and START to resume. Reply HELP for help.
      </p>
      <h2 className="text-base font-semibold">Contact</h2>
      <p>
        {b.name}
        {phone ? ` · ${phone}` : ""}
        {b.email ? ` · ${b.email}` : ""}
      </p>
    </main>
  );
}
