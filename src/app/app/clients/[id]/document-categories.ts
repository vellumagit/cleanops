/**
 * Document categories for a client's record. Shared by the page, the card
 * UI, and the upload action. Kept in a plain module (not the "use server"
 * actions file, which may only export async functions).
 */
export const CLIENT_DOCUMENT_CATEGORIES = [
  {
    key: "signed_invoice",
    label: "Signed invoices",
    hint: "Invoices the client signed and returned",
  },
  {
    key: "agreement",
    label: "Contracts & agreements",
    hint: "Service agreements, waivers, authorizations",
  },
  {
    key: "other",
    label: "Other",
    hint: "Anything else for this client's record",
  },
] as const;

export type ClientDocumentCategoryKey =
  (typeof CLIENT_DOCUMENT_CATEGORIES)[number]["key"];

export const CLIENT_DOCUMENT_CATEGORY_KEYS: ClientDocumentCategoryKey[] =
  CLIENT_DOCUMENT_CATEGORIES.map((c) => c.key);
