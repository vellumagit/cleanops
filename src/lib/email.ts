import "server-only";
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _client: MailerSend | null = null;

function getClient(): MailerSend | null {
  if (_client) return _client;
  const key = process.env.MAILERSEND_API_KEY;
  if (!key) return null;
  _client = new MailerSend({ apiKey: key });
  return _client;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.MAILERSEND_API_KEY);
}

// ---------------------------------------------------------------------------
// Default sender — used when org has no verified custom email
// ---------------------------------------------------------------------------

const DEFAULT_FROM_EMAIL =
  process.env.EMAIL_FROM ?? "noreply@sollos3.com";
const DEFAULT_FROM_NAME =
  process.env.EMAIL_FROM_NAME ?? "Sollos";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendEmailArgs = {
  /** Recipient address */
  to: string;
  /** Recipient display name (optional) */
  toName?: string;
  /** Email subject */
  subject: string;
  /** HTML body */
  html: string;
  /** Plain text fallback (auto-generated if omitted) */
  text?: string;
  /** Override the From address (must be verified in MailerSend) */
  from?: string;
  /** Override the From display name */
  fromName?: string;
  /** Reply-To address (falls back to from, then default) */
  replyTo?: string;
  /** Reply-To display name */
  replyToName?: string;
};

// ---------------------------------------------------------------------------
// Send — fire-and-forget safe (never throws, logs errors)
// ---------------------------------------------------------------------------

export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn("[email] MailerSend not configured, skipping:", args.subject);
    return false;
  }

  try {
    const fromEmail = args.from ?? DEFAULT_FROM_EMAIL;
    const fromName = args.fromName ?? DEFAULT_FROM_NAME;

    const params = new EmailParams()
      .setFrom(new Sender(fromEmail, fromName))
      .setTo([new Recipient(args.to, args.toName ?? args.to)])
      .setSubject(args.subject)
      .setHtml(args.html);

    if (args.text) {
      params.setText(args.text);
    }

    if (args.replyTo) {
      params.setReplyTo(
        new Sender(args.replyTo, args.replyToName ?? args.replyTo),
      );
    }

    await client.email.send(params);
    return true;
  } catch (err) {
    console.error("[email] send failed:", args.subject, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Org-aware sender — reads the org's verified sender email and uses it
// as From if verified, otherwise falls back to default + reply-to
// ---------------------------------------------------------------------------

type OrgSenderInfo = {
  from: string;
  fromName: string;
  replyTo?: string;
  replyToName?: string;
};

export async function getOrgSender(
  organizationId: string,
): Promise<OrgSenderInfo> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("name, sender_email, sender_email_verified_at")
    .eq("id", organizationId)
    .maybeSingle();

  const org = data as {
    name: string;
    sender_email: string | null;
    sender_email_verified_at: string | null;
  } | null;

  const isVerified = Boolean(
    org?.sender_email && org?.sender_email_verified_at,
  );

  if (isVerified && org?.sender_email) {
    // Verified custom domain — use as From directly.
    // MailerSend must also have this as a verified sender identity.
    return {
      from: org.sender_email,
      fromName: org.name,
    };
  }

  // Not verified — send from Sollos, but put their email in Reply-To
  // so client replies go to the right place.
  return {
    from: DEFAULT_FROM_EMAIL,
    fromName: DEFAULT_FROM_NAME,
    replyTo: org?.sender_email ?? undefined,
    replyToName: org?.name ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Convenience: send an email on behalf of an org
// ---------------------------------------------------------------------------

export async function sendOrgEmail(
  organizationId: string,
  args: Omit<SendEmailArgs, "from" | "fromName" | "replyTo" | "replyToName">,
): Promise<boolean> {
  const sender = await getOrgSender(organizationId);
  return sendEmail({
    ...args,
    from: sender.from,
    fromName: sender.fromName,
    replyTo: sender.replyTo,
    replyToName: sender.replyToName,
  });
}
