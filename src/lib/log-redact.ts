import "server-only";

/**
 * PII redaction helpers for LOG statements. Server logs (Vercel, etc.) have
 * long retention and are widely readable, so they must not become an unmanaged
 * store of customer phone numbers, emails, or message contents. Use these in
 * every `console.*` that would otherwise print PII.
 */

/** "+17805551234" → "…1234". Null-safe. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "(none)";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "…";
  return `…${digits.slice(-4)}`;
}

/** "brian@example.com" → "b…@example.com". Null-safe. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  const at = email.indexOf("@");
  if (at <= 0) return "…";
  return `${email[0]}…${email.slice(at)}`;
}
