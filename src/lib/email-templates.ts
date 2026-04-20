/**
 * Minimal HTML email templates for transactional emails.
 *
 * Each template returns { subject, html, text }. The HTML uses inline
 * styles (no CSS classes) because email clients strip <style> blocks.
 *
 * Visual language matches the Sollos app:
 *   - zinc-900 primary text (#18181b)
 *   - #fafafa page background
 *   - White card on #e4e4e7 border, matching .sollos-card
 *   - Indigo-500 accent (#6366f1) on CTA, or per-org brand_color
 *   - Tight tracking on headline wordmark, matching .sollos-hero
 *
 * Brand color comes from organizations.brand_color. Default indigo if none.
 * Org logo (header image) comes from organizations.logo_url. If absent, we
 * render a typographic wordmark of the org name in the same style as the app.
 */

const DEFAULT_BRAND = "#6366f1";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

type LayoutOptions = {
  /** Per-org brand color (hex, with or without leading #) */
  brandColor?: string;
  /** Org display name — shown under the logo/wordmark */
  orgName?: string;
  /** Public URL to the org's logo (organizations.logo_url). Rendered as <img>. */
  logoUrl?: string;
  /**
   * When true, the header renders the Sollos wordmark instead of an org
   * logo/wordmark. Use this for platform-sent emails (team invite, sender
   * verify, trial expiring) where Sollos is the sender, not an org.
   */
  sollosHeader?: boolean;
  /** Short, one-line preheader text shown in the inbox snippet. Optional. */
  preheader?: string;
};

function layout(body: string, options: LayoutOptions = {}) {
  const brand = options.brandColor
    ? `#${options.brandColor.replace(/^#/, "")}`
    : DEFAULT_BRAND;
  const orgName = options.orgName ?? "Sollos";

  // Header content: Sollos wordmark, org logo image, or org name wordmark
  let headerInner: string;
  if (options.sollosHeader) {
    headerInner = sollosWordmark();
  } else if (options.logoUrl) {
    headerInner = `
      <img
        src="${escapeAttr(options.logoUrl)}"
        alt="${escapeAttr(orgName)}"
        height="44"
        style="display:block;max-height:44px;width:auto;border:0;outline:none;text-decoration:none;"
      />
    `.trim();
  } else {
    headerInner = orgWordmark(orgName);
  }

  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(options.preheader)}</div>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#18181b;-webkit-font-smoothing:antialiased;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">

        <!-- Header -->
        <tr>
          <td align="center" style="padding:28px 32px 24px;border-bottom:1px solid #e4e4e7;background:#ffffff;">
            ${headerInner}
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 24px;border-top:1px solid #e4e4e7;background:#fafafa;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;text-align:center;">
              ${options.sollosHeader ? `Sent by <strong style="color:#18181b;">Sollos</strong>` : `Sent by <strong style="color:#18181b;">${escapeHtml(orgName)}</strong> via <a href="${SITE_URL}" style="color:#71717a;text-decoration:underline;">Sollos</a>`}
            </p>
            <p style="margin:6px 0 0;font-size:11px;line-height:1.5;color:#a1a1aa;text-align:center;">
              Operations software for cleaning companies
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
  <!-- Brand accent swatch (invisible tracker-free spacer, helps force proper width in some clients) -->
  <div style="display:none;color:${brand};">&nbsp;</div>
</body>
</html>`.trim();
}

/**
 * Sollos typographic wordmark — matches .sollos-hero h1 styling (tight
 * tracking, bold weight). Used for platform-sent emails.
 */
function sollosWordmark(): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:28px;font-weight:800;letter-spacing:-0.04em;color:#18181b;line-height:1;">
      sollos<sup style="font-size:0.55em;font-weight:700;letter-spacing:0;vertical-align:super;margin-left:1px;">3</sup>
    </div>
    <div style="margin-top:6px;font-size:10px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#a1a1aa;">
      Operations for Cleaners
    </div>
  `.trim();
}

/**
 * Org typographic wordmark — used when an org has no uploaded logo_url.
 * Renders the org name in the same app-heading style (bold, tight tracking)
 * so the email still feels branded, not generic.
 */
function orgWordmark(orgName: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.025em;color:#18181b;line-height:1.2;">
      ${escapeHtml(orgName)}
    </div>
  `.trim();
}

function button(label: string, href: string, color = DEFAULT_BRAND) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:${color};border-radius:8px;padding:13px 26px;box-shadow:0 1px 2px rgba(0,0,0,0.08);">
    <a href="${escapeAttr(href)}" target="_blank" rel="noopener" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;letter-spacing:-0.01em;">
      ${escapeHtml(label)}
    </a>
  </td></tr>
</table>`.trim();
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// ---------------------------------------------------------------------------
// Invoice sent
// ---------------------------------------------------------------------------

export function invoiceSentEmail(args: {
  clientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  dueDate: string;
  publicUrl: string;
  orgName: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Invoice ${args.invoiceNumber} from ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">New invoice</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, here's your invoice from <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Invoice</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.invoiceNumber)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Amount</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.amountFormatted)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Due</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.dueDate)}</td>
      </tr>
    </table>
    ${button("View & Pay Invoice", args.publicUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Questions? Reply to this email.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `Invoice ${args.invoiceNumber} · ${args.amountFormatted} · due ${args.dueDate}`,
    },
  );
  const text = `Invoice ${args.invoiceNumber} from ${args.orgName}\n\nAmount: ${args.amountFormatted}\nDue: ${args.dueDate}\n\nView: ${args.publicUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Team invite (Sollos platform email)
// ---------------------------------------------------------------------------

export function teamInviteEmail(args: {
  orgName: string;
  role: string;
  signupUrl: string;
  brandColor?: string;
}) {
  const subject = `You're invited to join ${args.orgName} on Sollos`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">You've been invited</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> invited you to join their team as
      <strong style="color:#18181b;">${escapeHtml(args.role)}</strong>.
    </p>
    ${button("Accept Invitation", args.signupUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      This link expires in 7 days. If you didn't expect this, ignore this email.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.orgName} invited you to join as ${args.role}`,
    },
  );
  const text = `${args.orgName} invited you to join as ${args.role}.\n\nAccept: ${args.signupUrl}\n\nLink expires in 7 days.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Sender email verification (Sollos platform email)
// ---------------------------------------------------------------------------

export function senderVerificationEmail(args: {
  orgName: string;
  verifyUrl: string;
  brandColor?: string;
}) {
  const subject = `Verify your sender email for ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Verify your email</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Click below to verify this email as the sender for
      <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> on Sollos.
      Invoices, booking confirmations, and other notifications will come from this address.
    </p>
    ${button("Verify Email Address", args.verifyUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      This link expires in 24 hours. If you didn't request this, ignore this email.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `Confirm sender email for ${args.orgName}`,
    },
  );
  const text = `Verify your sender email for ${args.orgName}.\n\nClick: ${args.verifyUrl}\n\nExpires in 24 hours.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Review request
// ---------------------------------------------------------------------------

export function reviewRequestEmail(args: {
  clientName: string;
  orgName: string;
  reviewUrl: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `How did we do? — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">How was your service?</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> would love your
      feedback. It only takes 30 seconds.
    </p>
    ${button("Leave a Review", args.reviewUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Your feedback helps us improve. Thank you!
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `${args.orgName} would love your feedback — it only takes 30 seconds`,
    },
  );
  const text = `Hi ${args.clientName}, ${args.orgName} would love your feedback.\n\nLeave a review: ${args.reviewUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Booking confirmation
// ---------------------------------------------------------------------------

export function bookingConfirmationEmail(args: {
  clientName: string;
  orgName: string;
  serviceName: string;
  dateTime: string;
  address: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Booking confirmed — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Booking confirmed</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, your booking with <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>
      is confirmed.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Service</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.serviceName)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">When</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.dateTime)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Where</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.address)}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Need to reschedule? Reply to this email.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `${args.serviceName} · ${args.dateTime}`,
    },
  );
  const text = `Booking confirmed — ${args.orgName}\n\nService: ${args.serviceName}\nWhen: ${args.dateTime}\nWhere: ${args.address}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Payment receipt
// ---------------------------------------------------------------------------

export function paymentReceiptEmail(args: {
  clientName: string;
  orgName: string;
  invoiceNumber: string;
  amountFormatted: string;
  paidDate: string;
  publicUrl: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Payment received — ${args.invoiceNumber}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Payment received</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, we received your payment. Thank you!
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Invoice</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.invoiceNumber)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Amount</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.amountFormatted)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Received</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.paidDate)}</td>
      </tr>
    </table>
    ${button("View Invoice", args.publicUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      This is your receipt. No further action needed.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `Payment of ${args.amountFormatted} received for ${args.invoiceNumber}`,
    },
  );
  const text = `Payment received — ${args.invoiceNumber}\n\nAmount: ${args.amountFormatted}\nReceived: ${args.paidDate}\n\nView: ${args.publicUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Trial expiring warning (Sollos platform email)
// ---------------------------------------------------------------------------

export function trialExpiringEmail(args: {
  userName: string;
  orgName: string;
  daysLeft: number;
  billingUrl: string;
  brandColor?: string;
}) {
  const urgency =
    args.daysLeft <= 1
      ? "Your free trial ends today"
      : `${args.daysLeft} days left in your free trial`;

  const subject = `${urgency} — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">${escapeHtml(urgency)}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.userName)}, your Sollos trial for <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>
      ${args.daysLeft <= 1
        ? "expires today. After today, you'll lose the ability to create new bookings, invoices, and estimates."
        : `has ${args.daysLeft} days remaining. Subscribe now to keep everything running smoothly when the trial ends.`}
    </p>
    <p style="margin:0 0 20px;font-size:13px;line-height:1.55;color:#52525b;">
      Your data is safe either way — subscribing just keeps the full feature set unlocked.
    </p>
    ${button("Choose a Plan", args.billingUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Questions? Reply to this email and we'll help.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: urgency,
    },
  );
  const text = `${urgency}\n\nHi ${args.userName}, your Sollos trial for ${args.orgName} ${args.daysLeft <= 1 ? "expires today." : `has ${args.daysLeft} days left.`}\n\nSubscribe: ${args.billingUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Booking reminder (org-sent — 24h-before-job heads-up to the client)
// ---------------------------------------------------------------------------

export function bookingReminderEmail(args: {
  clientName: string;
  orgName: string;
  serviceName: string;
  dateTime: string;
  address: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Reminder: your ${args.serviceName} with ${args.orgName} is tomorrow`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">See you tomorrow</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, just a friendly reminder that your
      appointment with <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> is coming up.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Service</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.serviceName)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">When</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.dateTime)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Where</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.address)}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Need to reschedule or cancel? Reply to this email as soon as possible and we&rsquo;ll sort it out.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `${args.serviceName} · ${args.dateTime}`,
    },
  );
  const text = `Reminder from ${args.orgName}\n\nService: ${args.serviceName}\nWhen: ${args.dateTime}\nWhere: ${args.address}\n\nReply to reschedule.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Estimate sent (org-sent — owner clicks "Send to client" on an estimate)
// ---------------------------------------------------------------------------

export function estimateSentEmail(args: {
  clientName: string;
  orgName: string;
  amountFormatted: string;
  serviceDescription: string;
  publicUrl: string;
  expiresOn: string | null;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Your estimate from ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Your estimate</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, here&rsquo;s the estimate from
      <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">Service</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.serviceDescription || "As discussed")}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;${args.expiresOn ? "border-bottom:1px solid #f4f4f5;" : ""}">Total</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;${args.expiresOn ? "border-bottom:1px solid #f4f4f5;" : ""}">${escapeHtml(args.amountFormatted)}</td>
      </tr>
      ${args.expiresOn
        ? `<tr>
            <td style="font-size:13px;color:#71717a;padding:12px 0;">Valid until</td>
            <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.expiresOn)}</td>
          </tr>`
        : ""}
    </table>
    ${button("View Estimate", args.publicUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Questions or ready to book? Reply to this email.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `${args.amountFormatted} · ${args.serviceDescription || "Estimate from " + args.orgName}`,
    },
  );
  const text = `Your estimate from ${args.orgName}\n\nService: ${args.serviceDescription || "As discussed"}\nTotal: ${args.amountFormatted}${args.expiresOn ? `\nValid until: ${args.expiresOn}` : ""}\n\nView: ${args.publicUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Booking rescheduled (org-sent — client notification)
// ---------------------------------------------------------------------------

export function bookingRescheduledEmail(args: {
  clientName: string;
  orgName: string;
  serviceName: string;
  oldDateTime: string;
  newDateTime: string;
  address: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Your booking has been rescheduled — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Booking rescheduled</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, your booking with <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> has been moved to a new time.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Service</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.serviceName)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Was</td>
        <td style="font-size:13px;color:#a1a1aa;padding:12px 0;text-align:right;text-decoration:line-through;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.oldDateTime)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Now</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.newDateTime)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Where</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.address)}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      This time doesn't work? Reply to this email and we'll find another slot.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `Moved from ${args.oldDateTime} to ${args.newDateTime}`,
    },
  );
  const text = `Booking rescheduled — ${args.orgName}\n\nService: ${args.serviceName}\nWas: ${args.oldDateTime}\nNow: ${args.newDateTime}\nWhere: ${args.address}\n\nReply to this email if the new time doesn't work.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Invoice overdue reminder (org-sent — client notification)
// ---------------------------------------------------------------------------

export function invoiceOverdueReminderEmail(args: {
  clientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  dueDate: string;
  daysOverdue: number;
  publicUrl: string;
  orgName: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const plural = args.daysOverdue === 1 ? "day" : "days";
  const subject = `Reminder: Invoice ${args.invoiceNumber} is ${args.daysOverdue} ${plural} overdue`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Invoice reminder</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, this is a friendly reminder that your invoice from <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> is now <strong style="color:#18181b;">${args.daysOverdue} ${plural} past due</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Invoice</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.invoiceNumber)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Amount</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.amountFormatted)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Was due</td>
        <td style="font-size:13px;color:#dc2626;padding:12px 0;text-align:right;">${escapeHtml(args.dueDate)}</td>
      </tr>
    </table>
    ${button("View & Pay Invoice", args.publicUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Already paid? Please ignore this message — it may have crossed with your payment. Questions? Reply to this email.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `${args.invoiceNumber} · ${args.amountFormatted} · ${args.daysOverdue} ${plural} overdue`,
    },
  );
  const text = `Invoice ${args.invoiceNumber} from ${args.orgName} is ${args.daysOverdue} ${plural} overdue.\n\nAmount: ${args.amountFormatted}\nWas due: ${args.dueDate}\n\nView & pay: ${args.publicUrl}\n\nAlready paid? Ignore this message.`;
  return { subject, html, text };
}
