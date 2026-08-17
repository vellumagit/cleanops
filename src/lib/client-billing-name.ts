/**
 * Who an invoice is addressed to.
 *
 * Svit cleans for people who run businesses from home. Their invoice has to
 * carry the COMPANY — that is what a bookkeeper files and an accountant
 * matches to the expense — while the relationship stays with the person who
 * answers the phone and opens the door.
 *
 * So one client has two names, and which one you use depends on what you are
 * writing, not on who you are writing to:
 *
 *   MONEY DOCUMENTS → the company, with the person as the contact.
 *                     Invoice, statement, PDF, hosted pay page, invoice email.
 *   EVERYTHING ELSE → the person. Bookings, schedule, field app, SMS,
 *                     reminders, the portal, chat.
 *
 * Both readings live here so they cannot drift apart across the six or seven
 * places that render them. A client with no company name is unaffected —
 * billingName() is just their name, and attn() is null — which is the
 * overwhelming majority and the default.
 */

export type BillableClient = {
  name?: string | null;
  company_name?: string | null;
};

/** Trimmed company name, or null when there isn't a usable one. */
function company(client: BillableClient | null | undefined): string | null {
  const raw = client?.company_name?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/**
 * The name at the top of a money document: the company when there is one,
 * otherwise the person. Never empty — falls back the way the rest of the app
 * does, so a nameless row renders as a placeholder rather than a blank line
 * on an invoice.
 */
export function clientBillingName(
  client: BillableClient | null | undefined,
): string {
  return company(client) ?? client?.name?.trim() ?? "Client";
}

/**
 * The "Attn:" line — the person to look for inside the company. Null when the
 * client is billed personally, because "Attn: themselves" under their own
 * name is noise.
 */
export function clientBillingAttn(
  client: BillableClient | null | undefined,
): string | null {
  if (!company(client)) return null;
  const person = client?.name?.trim();
  return person && person.length > 0 ? person : null;
}

/** True when this client bills under a business name. */
export function billsAsCompany(
  client: BillableClient | null | undefined,
): boolean {
  return company(client) != null;
}

/**
 * One line for places too tight for two — a list row, a PDF header, an email
 * subject: "Riverbend Consulting Ltd. (Dana Reid)".
 */
export function clientBillingLine(
  client: BillableClient | null | undefined,
): string {
  const attn = clientBillingAttn(client);
  const billed = clientBillingName(client);
  return attn ? `${billed} (${attn})` : billed;
}
