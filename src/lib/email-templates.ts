/**
 * Minimal HTML email templates for transactional emails.
 *
 * Each template returns { subject, html, text }. The HTML uses inline
 * styles (no CSS classes) because email clients strip <style> blocks.
 *
 * Brand color comes from the org's settings. We default to Sollos
 * indigo if none is set.
 */

const DEFAULT_BRAND = "#6366f1";

function layout(
  body: string,
  options?: { brandColor?: string; orgName?: string },
) {
  const brand = options?.brandColor
    ? `#${options.brandColor.replace(/^#/, "")}`
    : DEFAULT_BRAND;
  const org = options?.orgName ?? "Sollos";

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="height:4px;background:${brand};"></td></tr>
        <tr><td style="padding:32px 32px 24px;">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">
            Sent by ${org} via Sollos
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function button(label: string, href: string, color = DEFAULT_BRAND) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:${color};border-radius:6px;padding:12px 24px;">
    <a href="${href}" target="_blank" rel="noopener" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">
      ${label}
    </a>
  </td></tr>
</table>`.trim();
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
}) {
  const subject = `Invoice ${args.invoiceNumber} from ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;color:#18181b;">New invoice</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#52525b;">
      Hi ${args.clientName}, here's your invoice from <strong>${args.orgName}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:8px;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:6px 0;">Invoice</td>
        <td style="font-size:13px;color:#18181b;padding:6px 0;text-align:right;font-weight:600;">${args.invoiceNumber}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:6px 0;">Amount</td>
        <td style="font-size:13px;color:#18181b;padding:6px 0;text-align:right;font-weight:600;">${args.amountFormatted}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:6px 0;">Due</td>
        <td style="font-size:13px;color:#18181b;padding:6px 0;text-align:right;">${args.dueDate}</td>
      </tr>
    </table>
    ${button("View & Pay Invoice", args.publicUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;">
      If you have questions, reply to this email.
    </p>
    `,
    { brandColor: args.brandColor, orgName: args.orgName },
  );
  const text = `Invoice ${args.invoiceNumber} from ${args.orgName}\n\nAmount: ${args.amountFormatted}\nDue: ${args.dueDate}\n\nView: ${args.publicUrl}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Team invite
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
    <h1 style="margin:0 0 8px;font-size:20px;color:#18181b;">You've been invited</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#52525b;">
      <strong>${args.orgName}</strong> has invited you to join their team as
      <strong>${args.role}</strong>.
    </p>
    ${button("Accept Invitation", args.signupUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;">
      This link expires in 7 days. If you didn't expect this, ignore this email.
    </p>
    `,
    { orgName: args.orgName },
  );
  const text = `${args.orgName} invited you to join as ${args.role}.\n\nAccept: ${args.signupUrl}\n\nLink expires in 7 days.`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Sender email verification
// ---------------------------------------------------------------------------

export function senderVerificationEmail(args: {
  orgName: string;
  verifyUrl: string;
}) {
  const subject = `Verify your sender email for ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;color:#18181b;">Verify your email</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#52525b;">
      Click below to verify this email as the sender for
      <strong>${args.orgName}</strong> on Sollos. Invoices, booking
      confirmations, and other notifications will come from this address.
    </p>
    ${button("Verify Email Address", args.verifyUrl)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;">
      This link expires in 24 hours. If you didn't request this, ignore this email.
    </p>
    `,
    { orgName: args.orgName },
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
}) {
  const subject = `How did we do? — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;color:#18181b;">How was your service?</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#52525b;">
      Hi ${args.clientName}, <strong>${args.orgName}</strong> would love your
      feedback. It only takes 30 seconds.
    </p>
    ${button("Leave a Review", args.reviewUrl, args.brandColor ? `#${args.brandColor.replace(/^#/, "")}` : DEFAULT_BRAND)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;">
      Your feedback helps us improve. Thank you!
    </p>
    `,
    { brandColor: args.brandColor, orgName: args.orgName },
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
}) {
  const subject = `Booking confirmed — ${args.orgName}`;
  const html = layout(
    `
    <h1 style="margin:0 0 8px;font-size:20px;color:#18181b;">Booking confirmed</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#52525b;">
      Hi ${args.clientName}, your booking with <strong>${args.orgName}</strong>
      is confirmed.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding:6px 0;">Service</td>
        <td style="font-size:13px;color:#18181b;padding:6px 0;text-align:right;">${args.serviceName}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:6px 0;">When</td>
        <td style="font-size:13px;color:#18181b;padding:6px 0;text-align:right;">${args.dateTime}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#71717a;padding:6px 0;">Where</td>
        <td style="font-size:13px;color:#18181b;padding:6px 0;text-align:right;">${args.address}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;color:#a1a1aa;">
      Need to reschedule? Reply to this email.
    </p>
    `,
    { brandColor: args.brandColor, orgName: args.orgName },
  );
  const text = `Booking confirmed — ${args.orgName}\n\nService: ${args.serviceName}\nWhen: ${args.dateTime}\nWhere: ${args.address}`;
  return { subject, html, text };
}
