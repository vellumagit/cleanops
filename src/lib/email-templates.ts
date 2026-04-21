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
// Employee: daily schedule email
// ---------------------------------------------------------------------------

export function employeeDailyScheduleEmail(args: {
  recipientName: string;
  orgName: string;
  dateLabel: string; // e.g. "Monday, Apr 21"
  jobs: Array<{
    time: string; // "8:00 AM"
    serviceName: string;
    clientName: string;
    address: string;
    durationLabel: string; // "2h"
    notes: string | null;
  }>;
  fieldAppUrl: string;
}) {
  const n = args.jobs.length;
  const subject =
    n === 0
      ? `No jobs scheduled today — ${args.orgName}`
      : n === 1
        ? `Your job today — ${args.orgName}`
        : `Your ${n} jobs today — ${args.orgName}`;

  const rows =
    n === 0
      ? `<p style="margin:12px 0;font-size:13px;color:#71717a;font-style:italic;">Nothing on your schedule. Enjoy the day.</p>`
      : args.jobs
          .map(
            (j) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;width:90px;">
        <div style="font-size:15px;color:#18181b;font-weight:700;letter-spacing:-0.01em;">${escapeHtml(j.time)}</div>
        <div style="font-size:11px;color:#71717a;margin-top:2px;">${escapeHtml(j.durationLabel)}</div>
      </td>
      <td style="padding:14px 0 14px 16px;border-bottom:1px solid #f4f4f5;vertical-align:top;">
        <div style="font-size:14px;color:#18181b;font-weight:600;">${escapeHtml(j.serviceName)}</div>
        <div style="font-size:12px;color:#52525b;margin-top:3px;">${escapeHtml(j.clientName)}</div>
        <div style="font-size:12px;color:#71717a;margin-top:2px;">${escapeHtml(j.address)}</div>
        ${j.notes ? `<div style="margin-top:8px;padding:8px 10px;background:#fafafa;border-radius:6px;font-size:12px;color:#52525b;line-height:1.45;white-space:pre-wrap;">${escapeHtml(j.notes)}</div>` : ""}
      </td>
    </tr>`,
          )
          .join("");

  const html = layout(
    `
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Today&rsquo;s schedule</h1>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, here&rsquo;s your day at <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#a1a1aa;">${escapeHtml(args.dateLabel)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e4e4e7;">
      ${rows}
    </table>
    ${n > 0 ? button("Open in Field App", args.fieldAppUrl) : ""}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Questions about a job? Message your manager in Sollos.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader:
        n === 0
          ? "No jobs today — enjoy the day"
          : `${n} job${n === 1 ? "" : "s"} · first at ${args.jobs[0]?.time}`,
    },
  );

  const text =
    n === 0
      ? `No jobs scheduled for ${args.dateLabel}. Enjoy the day.`
      : `Your schedule for ${args.dateLabel}\n\n${args.jobs.map((j) => `${j.time} — ${j.serviceName} for ${j.clientName} (${j.durationLabel})\n  ${j.address}${j.notes ? `\n  Notes: ${j.notes}` : ""}`).join("\n\n")}\n\nOpen: ${args.fieldAppUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Employee: weekly schedule email
// ---------------------------------------------------------------------------

export function employeeWeeklyScheduleEmail(args: {
  recipientName: string;
  orgName: string;
  weekLabel: string;
  days: Array<{
    dateLabel: string; // "Monday, Apr 21"
    jobs: Array<{
      time: string;
      serviceName: string;
      clientName: string;
    }>;
  }>;
  totalJobs: number;
  fieldAppUrl: string;
}) {
  const subject = `Your week ahead — ${args.totalJobs} job${args.totalJobs === 1 ? "" : "s"}`;

  const dayBlocks = args.days
    .map((d) => {
      if (d.jobs.length === 0) {
        return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #f4f4f5;">
        <div style="font-size:13px;color:#18181b;font-weight:600;">${escapeHtml(d.dateLabel)}</div>
        <div style="margin-top:4px;font-size:12px;color:#a1a1aa;font-style:italic;">No jobs</div>
      </td>
    </tr>`;
      }
      const jobLines = d.jobs
        .map(
          (j) => `
        <div style="margin-top:6px;font-size:12px;color:#52525b;line-height:1.5;">
          <strong style="color:#18181b;">${escapeHtml(j.time)}</strong> — ${escapeHtml(j.serviceName)} for ${escapeHtml(j.clientName)}
        </div>`,
        )
        .join("");
      return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #f4f4f5;">
        <div style="font-size:13px;color:#18181b;font-weight:600;">${escapeHtml(d.dateLabel)}</div>
        ${jobLines}
      </td>
    </tr>`;
    })
    .join("");

  const html = layout(
    `
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Your week ahead</h1>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, you have <strong style="color:#18181b;">${args.totalJobs} job${args.totalJobs === 1 ? "" : "s"}</strong> scheduled this week at <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#a1a1aa;">${escapeHtml(args.weekLabel)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e4e4e7;">
      ${dayBlocks}
    </table>
    ${button("Open in Field App", args.fieldAppUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      You&rsquo;ll also get a daily version every morning with full details for that day&rsquo;s jobs.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.totalJobs} job${args.totalJobs === 1 ? "" : "s"} — ${args.weekLabel}`,
    },
  );
  const text = `Your week ahead — ${args.orgName}\n${args.weekLabel}\n${args.totalJobs} total job${args.totalJobs === 1 ? "" : "s"}\n\n${args.days
    .map(
      (d) =>
        `${d.dateLabel}:\n${d.jobs.length === 0 ? "  (no jobs)" : d.jobs.map((j) => `  ${j.time} — ${j.serviceName} for ${j.clientName}`).join("\n")}`,
    )
    .join("\n\n")}\n\nOpen: ${args.fieldAppUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Employee: overtime warning
// ---------------------------------------------------------------------------

export function employeeOvertimeWarningEmail(args: {
  recipientName: string;
  orgName: string;
  hoursWorked: string; // e.g. "38.5"
  thresholdHours: string; // e.g. "40"
  weekLabel: string;
  isOver: boolean;
}) {
  const subject = args.isOver
    ? `You&rsquo;ve passed ${args.thresholdHours}h this week`
    : `Heads up: approaching ${args.thresholdHours}h this week`;
  const headline = args.isOver
    ? "You&rsquo;ve crossed into overtime"
    : "You&rsquo;re approaching overtime";
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">${headline}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, a heads-up from <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <div style="margin:16px 0;padding:20px;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;text-align:center;">
      <div style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">This week so far</div>
      <div style="margin-top:6px;font-size:36px;color:${args.isOver ? "#dc2626" : "#18181b"};font-weight:800;letter-spacing:-0.03em;">${escapeHtml(args.hoursWorked)} h</div>
      <div style="margin-top:2px;font-size:12px;color:#71717a;">Threshold: ${escapeHtml(args.thresholdHours)} h</div>
    </div>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.55;color:#52525b;">
      ${args.isOver
        ? "You're already past your weekly threshold. If this isn't expected, talk to your manager — any additional hours this week may be overtime."
        : "You're close to your weekly threshold. If that's a concern, let your manager know before taking on more jobs this week."}
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      ${escapeHtml(args.weekLabel)}
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.hoursWorked} h of ${args.thresholdHours} h`,
    },
  );
  const text = `${headline.replace(/&rsquo;/g, "'")} — ${args.orgName}\n\nYou've worked ${args.hoursWorked}h this week (threshold ${args.thresholdHours}h).\n\n${args.weekLabel}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Employee: PTO request status
// ---------------------------------------------------------------------------

export function employeePtoStatusEmail(args: {
  recipientName: string;
  orgName: string;
  status: "approved" | "declined" | "cancelled";
  startDate: string;
  endDate: string;
  hours: number;
  reason: string | null;
  dashboardUrl: string;
}) {
  const label =
    args.status === "approved"
      ? "approved"
      : args.status === "declined"
        ? "declined"
        : "cancelled";
  const subject = `Your time-off request was ${label}`;
  const accentColor =
    args.status === "approved"
      ? "#059669"
      : args.status === "declined"
        ? "#dc2626"
        : "#71717a";
  const headline =
    args.status === "approved"
      ? "Your time-off is approved"
      : args.status === "declined"
        ? "Your time-off request was declined"
        : "Your time-off request was cancelled";
  const body =
    args.status === "approved"
      ? "Enjoy the time off. Your schedule for these dates is already adjusted."
      : args.status === "declined"
        ? "Your manager declined this request. Reach out to them for context if needed."
        : "This request has been cancelled.";

  const dateRange =
    args.startDate === args.endDate
      ? args.startDate
      : `${args.startDate} – ${args.endDate}`;

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${accentColor};line-height:1.3;">${headline}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, ${body}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Dates</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(dateRange)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;${args.reason ? "border-bottom:1px solid #f4f4f5;" : ""}">Hours</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;${args.reason ? "border-bottom:1px solid #f4f4f5;" : ""}">${args.hours}</td>
      </tr>
      ${args.reason ? `<tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;vertical-align:top;">Reason</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.reason)}</td>
      </tr>` : ""}
    </table>
    ${button("View in Sollos", args.dashboardUrl)}
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${dateRange} · ${args.hours}h — ${label}`,
    },
  );
  const text = `Your time-off request was ${label} — ${args.orgName}\n\nDates: ${dateRange}\nHours: ${args.hours}${args.reason ? `\nReason: ${args.reason}` : ""}\n\nOpen: ${args.dashboardUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Employee: payroll paid receipt
// ---------------------------------------------------------------------------

export function employeePayrollPaidEmail(args: {
  recipientName: string;
  orgName: string;
  amountFormatted: string;
  periodStart: string;
  periodEnd: string;
  hoursWorked: string;
  regularPay: string;
  bonusPay: string;
  ptoPay: string;
  paidDate: string;
  dashboardUrl: string;
}) {
  const subject = `You were paid ${args.amountFormatted}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Payday</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> just marked your payroll as paid.
    </p>
    <div style="margin:16px 0;padding:20px;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;text-align:center;">
      <div style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">You were paid</div>
      <div style="margin-top:6px;font-size:36px;color:#059669;font-weight:800;letter-spacing:-0.03em;">${escapeHtml(args.amountFormatted)}</div>
      <div style="margin-top:4px;font-size:12px;color:#71717a;">on ${escapeHtml(args.paidDate)}</div>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Pay period</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.periodStart)} – ${escapeHtml(args.periodEnd)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Hours worked</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.hoursWorked)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Regular pay</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.regularPay)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Bonuses</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.bonusPay)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">PTO pay</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;">${escapeHtml(args.ptoPay)}</td>
      </tr>
    </table>
    ${button("View Pay Details", args.dashboardUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      This is confirmation from Sollos only — the actual deposit timing depends on your employer&rsquo;s payment method.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.amountFormatted} on ${args.paidDate}`,
    },
  );
  const text = `You were paid ${args.amountFormatted} — ${args.orgName}\n\nPeriod: ${args.periodStart} – ${args.periodEnd}\nHours: ${args.hoursWorked}\nRegular: ${args.regularPay}\nBonuses: ${args.bonusPay}\nPTO: ${args.ptoPay}\nPaid: ${args.paidDate}\n\nView: ${args.dashboardUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Employee: training assigned
// ---------------------------------------------------------------------------

export function employeeTrainingAssignedEmail(args: {
  recipientName: string;
  orgName: string;
  moduleTitle: string;
  moduleDescription: string | null;
  trainingUrl: string;
}) {
  const subject = `New training: ${args.moduleTitle}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">New training for you</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> assigned you a new training module.
    </p>
    <div style="margin:16px 0;padding:16px 20px;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;">
      <div style="font-size:15px;color:#18181b;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(args.moduleTitle)}</div>
      ${args.moduleDescription
        ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.55;color:#52525b;white-space:pre-wrap;">${escapeHtml(args.moduleDescription)}</p>`
        : ""}
    </div>
    ${button("Start Training", args.trainingUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Most modules take less than 10 minutes. You can pause and resume anytime.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: args.moduleDescription ?? `New training: ${args.moduleTitle}`,
    },
  );
  const text = `New training: ${args.moduleTitle}\n\n${args.moduleDescription ?? ""}\n\nStart: ${args.trainingUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Employee: certification expiry reminder
// ---------------------------------------------------------------------------

export function employeeCertificationExpiryEmail(args: {
  recipientName: string;
  orgName: string;
  moduleTitle: string;
  expiresOn: string;
  daysUntilExpiry: number;
  trainingUrl: string;
}) {
  const subject =
    args.daysUntilExpiry <= 7
      ? `Urgent: ${args.moduleTitle} expires in ${args.daysUntilExpiry} day${args.daysUntilExpiry === 1 ? "" : "s"}`
      : `Reminder: ${args.moduleTitle} expires in ${args.daysUntilExpiry} days`;

  const headline =
    args.daysUntilExpiry <= 7
      ? "Certification expiring soon"
      : "Certification expiring in 30 days";
  const accentColor = args.daysUntilExpiry <= 7 ? "#dc2626" : "#d97706";

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${accentColor};line-height:1.3;">${headline}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, your certification at <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> will expire soon. Renew by retaking the training before it lapses.
    </p>
    <div style="margin:16px 0;padding:16px 20px;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;">
      <div style="font-size:15px;color:#18181b;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(args.moduleTitle)}</div>
      <div style="margin-top:6px;font-size:12px;color:${accentColor};font-weight:600;">Expires ${escapeHtml(args.expiresOn)} (${args.daysUntilExpiry} day${args.daysUntilExpiry === 1 ? "" : "s"})</div>
    </div>
    ${button("Retake Training", args.trainingUrl)}
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.moduleTitle} — expires ${args.expiresOn}`,
    },
  );
  const text = `${headline} — ${args.orgName}\n\n${args.moduleTitle}\nExpires ${args.expiresOn} (${args.daysUntilExpiry} days)\n\nRetake: ${args.trainingUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Admin: unassigned booking alert (Sollos → owner/admin)
// ---------------------------------------------------------------------------

export function unassignedBookingAlertEmail(args: {
  recipientName: string;
  orgName: string;
  dashboardUrl: string;
  bookings: Array<{
    clientName: string;
    serviceName: string;
    dateTime: string;
    address: string;
    hoursUntil: number;
  }>;
}) {
  const n = args.bookings.length;
  const subject =
    n === 1
      ? `Action needed: 1 unassigned booking coming up`
      : `Action needed: ${n} unassigned bookings coming up`;

  const rows = args.bookings
    .map(
      (b) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">
        <div style="font-size:13px;color:#18181b;font-weight:600;">${escapeHtml(b.serviceName)}</div>
        <div style="font-size:12px;color:#71717a;margin-top:2px;">${escapeHtml(b.clientName)} · ${escapeHtml(b.address)}</div>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #f4f4f5;text-align:right;vertical-align:top;">
        <div style="font-size:13px;color:#18181b;">${escapeHtml(b.dateTime)}</div>
        <div style="font-size:11px;color:#dc2626;margin-top:2px;font-weight:600;">in ${b.hoursUntil}h</div>
      </td>
    </tr>`,
    )
    .join("");

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Bookings need staffing</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, the following ${n === 1 ? "booking is" : `${n} bookings are`} scheduled for the next 24 hours at <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> with no cleaner assigned.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      ${rows}
    </table>
    ${button("Open Bookings", args.dashboardUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      This alert fires at most once per booking. You won&rsquo;t hear from us again about these specific jobs — unless one gets unassigned after you staff it.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${n} unassigned booking${n === 1 ? "" : "s"} in the next 24 hours`,
    },
  );
  const text = `Unassigned bookings — ${args.orgName}\n\n${args.bookings
    .map(
      (b) =>
        `• ${b.serviceName} for ${b.clientName} — ${b.dateTime} (in ${b.hoursUntil}h) — ${b.address}`,
    )
    .join("\n")}\n\nOpen: ${args.dashboardUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Admin: low review alert (Sollos → owner/admin, on ≤3★ reviews)
// ---------------------------------------------------------------------------

export function lowReviewAlertEmail(args: {
  recipientName: string;
  orgName: string;
  clientName: string;
  employeeName: string | null;
  rating: number;
  reviewText: string | null;
  reviewUrl: string;
}) {
  const subject = `${args.rating}-star review needs attention`;
  const stars = "★".repeat(args.rating) + "☆".repeat(5 - args.rating);
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">A review needs your attention</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, <strong style="color:#18181b;">${escapeHtml(args.clientName)}</strong> left a low review${args.employeeName ? ` for ${escapeHtml(args.employeeName)}` : ""}. Reaching out fast usually saves the relationship.
    </p>
    <div style="margin:16px 0;padding:16px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;">
      <div style="font-size:20px;letter-spacing:2px;color:#f59e0b;">${stars}</div>
      <div style="margin-top:6px;font-size:12px;color:#71717a;">${args.rating} out of 5</div>
      ${args.reviewText
        ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#18181b;white-space:pre-wrap;">"${escapeHtml(args.reviewText)}"</p>`
        : `<p style="margin:12px 0 0;font-size:12px;color:#a1a1aa;font-style:italic;">No written feedback — just the rating.</p>`}
    </div>
    ${button("Open Review", args.reviewUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Low reviews only come by email. Everything else stays in the in-app notification feed.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${stars} from ${args.clientName}`,
    },
  );
  const text = `A ${args.rating}-star review came in from ${args.clientName}${args.employeeName ? ` for ${args.employeeName}` : ""}.\n\n${args.reviewText ?? "(No written feedback)"}\n\nOpen: ${args.reviewUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Admin: Stripe payout notification (Sollos → owner)
// ---------------------------------------------------------------------------

export function stripePayoutAlertEmail(args: {
  recipientName: string;
  orgName: string;
  amountFormatted: string;
  arrivalDate: string;
  payoutId: string;
  dashboardUrl: string;
}) {
  const subject = `Stripe paid you ${args.amountFormatted}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">You&rsquo;ve been paid</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, Stripe just sent a payout to your bank account for <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Amount</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;font-weight:600;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.amountFormatted)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Arrives in your bank</td>
        <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.arrivalDate)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Payout id</td>
        <td style="font-size:12px;color:#71717a;padding:12px 0;text-align:right;font-family:ui-monospace,Menlo,monospace;">${escapeHtml(args.payoutId)}</td>
      </tr>
    </table>
    ${button("Open Dashboard", args.dashboardUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Stripe handles the actual bank transfer. You&rsquo;ll see it in your statement on or around the arrival date.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.amountFormatted} arriving ${args.arrivalDate}`,
    },
  );
  const text = `Stripe paid you ${args.amountFormatted} for ${args.orgName}.\n\nArriving: ${args.arrivalDate}\nPayout id: ${args.payoutId}\n\nDashboard: ${args.dashboardUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Admin: Weekly ops digest (Sollos → owner, every Monday)
// ---------------------------------------------------------------------------

export type DigestStat = { label: string; value: string; sub?: string };

export function weeklyOpsDigestEmail(args: {
  recipientName: string;
  orgName: string;
  weekLabel: string;
  stats: DigestStat[];
  upcomingUnassigned: number;
  dashboardUrl: string;
}) {
  const subject = `Your weekly recap — ${args.orgName}`;
  const statRows = args.stats
    .map(
      (s) => `
    <tr>
      <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">
        ${escapeHtml(s.label)}
      </td>
      <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;vertical-align:top;">
        <div style="font-weight:600;">${escapeHtml(s.value)}</div>
        ${s.sub ? `<div style="font-size:11px;color:#a1a1aa;margin-top:2px;font-weight:normal;">${escapeHtml(s.sub)}</div>` : ""}
      </td>
    </tr>`,
    )
    .join("");

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Your week at a glance</h1>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, here&rsquo;s what happened at <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa;">
      ${escapeHtml(args.weekLabel)}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      ${statRows}
    </table>
    ${args.upcomingUnassigned > 0
      ? `<div style="margin:20px 0;padding:12px 14px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2;">
          <p style="margin:0;font-size:13px;color:#991b1b;">
            <strong>${args.upcomingUnassigned}</strong> upcoming booking${args.upcomingUnassigned === 1 ? "" : "s"} still ${args.upcomingUnassigned === 1 ? "has" : "have"} no cleaner assigned.
          </p>
        </div>`
      : ""}
    ${button("Open Dashboard", args.dashboardUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      You can turn this weekly recap off in Settings → Automations.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.weekLabel} — ${args.stats[0]?.value ?? ""}`,
    },
  );
  const text = `Weekly recap — ${args.orgName}\n${args.weekLabel}\n\n${args.stats
    .map((s) => `${s.label}: ${s.value}${s.sub ? ` (${s.sub})` : ""}`)
    .join("\n")}${args.upcomingUnassigned > 0 ? `\n\n⚠ ${args.upcomingUnassigned} upcoming booking(s) unassigned.` : ""}\n\nOpen: ${args.dashboardUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Admin: Monthly ops digest (Sollos → owner, 1st of the month)
// ---------------------------------------------------------------------------

export function monthlyOpsDigestEmail(args: {
  recipientName: string;
  orgName: string;
  monthLabel: string;
  stats: DigestStat[];
  topClients: Array<{ name: string; revenue: string; jobs: number }>;
  topEmployee: { name: string; jobs: number } | null;
  dashboardUrl: string;
}) {
  const subject = `${args.monthLabel} recap — ${args.orgName}`;
  const statRows = args.stats
    .map(
      (s) => `
    <tr>
      <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">
        ${escapeHtml(s.label)}
      </td>
      <td style="font-size:13px;color:#18181b;padding:12px 0;text-align:right;border-bottom:1px solid #f4f4f5;vertical-align:top;">
        <div style="font-weight:600;">${escapeHtml(s.value)}</div>
        ${s.sub ? `<div style="font-size:11px;color:#a1a1aa;margin-top:2px;font-weight:normal;">${escapeHtml(s.sub)}</div>` : ""}
      </td>
    </tr>`,
    )
    .join("");

  const clientRows = args.topClients.length
    ? args.topClients
        .map(
          (c, i) => `
      <tr>
        <td style="font-size:13px;color:#a1a1aa;padding:10px 0;border-bottom:1px solid #f4f4f5;width:24px;vertical-align:top;">${i + 1}</td>
        <td style="font-size:13px;color:#18181b;padding:10px 0;border-bottom:1px solid #f4f4f5;vertical-align:top;">
          <div>${escapeHtml(c.name)}</div>
          <div style="font-size:11px;color:#71717a;margin-top:2px;">${c.jobs} job${c.jobs === 1 ? "" : "s"}</div>
        </td>
        <td style="font-size:13px;color:#18181b;padding:10px 0;text-align:right;border-bottom:1px solid #f4f4f5;font-weight:600;vertical-align:top;">${escapeHtml(c.revenue)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="font-size:12px;color:#a1a1aa;padding:12px 0;font-style:italic;">No paid jobs in this period.</td></tr>`;

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">${escapeHtml(args.monthLabel)} recap</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.recipientName)}, here&rsquo;s how <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> did last month.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;border-top:1px solid #e4e4e7;">
      ${statRows}
    </table>

    <h2 style="margin:16px 0 6px;font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#18181b;">Top clients</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;border-top:1px solid #e4e4e7;">
      ${clientRows}
    </table>

    ${args.topEmployee
      ? `<h2 style="margin:16px 0 6px;font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#18181b;">Top performer</h2>
         <p style="margin:0 0 16px;font-size:13px;color:#52525b;">
           <strong style="color:#18181b;">${escapeHtml(args.topEmployee.name)}</strong> worked ${args.topEmployee.jobs} job${args.topEmployee.jobs === 1 ? "" : "s"}.
         </p>`
      : ""}

    ${button("Open Dashboard", args.dashboardUrl)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      You can turn this monthly recap off in Settings → Automations.
    </p>
    `,
    {
      sollosHeader: true,
      orgName: args.orgName,
      preheader: `${args.monthLabel} at ${args.orgName}`,
    },
  );
  const text = `${args.monthLabel} recap — ${args.orgName}\n\n${args.stats
    .map((s) => `${s.label}: ${s.value}${s.sub ? ` (${s.sub})` : ""}`)
    .join(
      "\n",
    )}\n\nTop clients:\n${args.topClients.map((c, i) => `  ${i + 1}. ${c.name} — ${c.revenue} (${c.jobs} jobs)`).join("\n")}${args.topEmployee ? `\n\nTop performer: ${args.topEmployee.name} — ${args.topEmployee.jobs} jobs` : ""}\n\nOpen: ${args.dashboardUrl}`;
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
// Booking cancelled (org-sent — client notification)
// ---------------------------------------------------------------------------

export function bookingCancelledEmail(args: {
  clientName: string;
  orgName: string;
  serviceName: string;
  dateTime: string;
  address: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Booking cancelled — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Booking cancelled</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, your upcoming booking with <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong> has been cancelled.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:4px;border-top:1px solid #e4e4e7;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">Service</td>
        <td style="font-size:13px;color:#a1a1aa;padding:12px 0;text-align:right;text-decoration:line-through;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.serviceName)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;border-bottom:1px solid #f4f4f5;">When</td>
        <td style="font-size:13px;color:#a1a1aa;padding:12px 0;text-align:right;text-decoration:line-through;border-bottom:1px solid #f4f4f5;">${escapeHtml(args.dateTime)}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:12px 0;">Where</td>
        <td style="font-size:13px;color:#a1a1aa;padding:12px 0;text-align:right;text-decoration:line-through;">${escapeHtml(args.address)}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.55;color:#52525b;">
      If you&rsquo;d like to reschedule or book a new service, just reply to this email.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `${args.serviceName} on ${args.dateTime} is cancelled`,
    },
  );
  const text = `Booking cancelled — ${args.orgName}\n\nService: ${args.serviceName}\nWhen: ${args.dateTime}\nWhere: ${args.address}\n\nReply to reschedule.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Rebooking prompt (org-sent — "time for your next clean?")
// ---------------------------------------------------------------------------

export function rebookingPromptEmail(args: {
  clientName: string;
  orgName: string;
  daysSinceLastService: number;
  bookingUrl: string;
  replyToAddress: string;
  brandColor?: string;
  logoUrl?: string;
}) {
  const subject = `Ready for your next clean? — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#18181b;line-height:1.3;">Time for another clean?</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, it&rsquo;s been about
      <strong style="color:#18181b;">${args.daysSinceLastService} days</strong>
      since your last service with <strong style="color:#18181b;">${escapeHtml(args.orgName)}</strong>. Ready to book another?
    </p>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#52525b;">
      Reply to this email with a date and time that works, or hit the button
      below to get in touch. We&rsquo;ll confirm a slot within a day.
    </p>
    ${button("Book My Next Clean", `mailto:${args.replyToAddress}?subject=${encodeURIComponent("Ready to book my next clean")}`, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Not ready yet? No rush — we&rsquo;ll reach out again later. If you&rsquo;d
      prefer no reminders, let us know and we&rsquo;ll stop.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: `Your last clean was ${args.daysSinceLastService} days ago — ready for another?`,
    },
  );
  const text = `Time for another clean? — ${args.orgName}\n\nHi ${args.clientName}, it's been about ${args.daysSinceLastService} days since your last service. Reply with a date/time that works and we'll confirm.\n\n${args.replyToAddress}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Estimate follow-up (org-sent — "still interested?" at 7 or 14 days)
// ---------------------------------------------------------------------------

export function estimateFollowupEmail(args: {
  clientName: string;
  orgName: string;
  amountFormatted: string;
  publicUrl: string;
  stage: "day7" | "day14";
  brandColor?: string;
  logoUrl?: string;
}) {
  const is7d = args.stage === "day7";
  const subject = is7d
    ? `Any questions on your estimate? — ${args.orgName}`
    : `Last chance — your estimate expires soon`;
  const headline = is7d
    ? "Still thinking it over?"
    : "Your estimate expires soon";
  const body = is7d
    ? "Just checking in on the estimate we sent last week. If you have any questions or want to tweak the scope, reply to this email and we&rsquo;ll sort it out."
    : "The estimate we sent a couple weeks ago will auto-expire in the next few days. If you&rsquo;d still like to move forward, now&rsquo;s the time.";

  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${is7d ? "#18181b" : "#d97706"};line-height:1.3;">${headline}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#52525b;">
      Hi ${escapeHtml(args.clientName)}, ${body}
    </p>
    <div style="margin:16px 0;padding:16px 20px;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa;">
      <div style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Your estimate from ${escapeHtml(args.orgName)}</div>
      <div style="margin-top:6px;font-size:26px;font-weight:800;letter-spacing:-0.02em;color:#18181b;">${escapeHtml(args.amountFormatted)}</div>
    </div>
    ${button(is7d ? "View Estimate" : "View Before It Expires", args.publicUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
      Already decided to go another way? No hard feelings — just reply to let us know and we&rsquo;ll close it out.
    </p>
    `,
    {
      brandColor: args.brandColor,
      orgName: args.orgName,
      logoUrl: args.logoUrl,
      preheader: is7d
        ? "Any questions on your estimate?"
        : "Your estimate expires in a few days",
    },
  );
  const text = `${headline} — ${args.orgName}\n\nHi ${args.clientName}, ${body.replace(/&rsquo;/g, "'")}\n\nAmount: ${args.amountFormatted}\nView: ${args.publicUrl}`;
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
