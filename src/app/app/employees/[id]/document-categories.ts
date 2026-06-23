/**
 * Document categories for an employee's file. Shared by the page, the panel
 * UI, and the upload action. Kept in a plain module (not the "use server"
 * actions file, which may only export async functions).
 */
export const DOCUMENT_CATEGORIES = [
  {
    key: "contract",
    label: "Contracts & Agreements",
    hint: "Employment agreements, offer letters, NDAs",
  },
  {
    key: "id",
    label: "Identification",
    hint: "Photo ID, SIN, work permit",
  },
  {
    key: "certification",
    label: "Certifications & Training",
    hint: "WHMIS, first aid, course certificates",
  },
  {
    key: "banking",
    label: "Banking & Payroll",
    hint: "Void cheque, direct deposit form, TD1",
  },
  {
    key: "insurance",
    label: "Insurance & WCB",
    hint: "WCB clearance, liability coverage",
  },
  {
    key: "other",
    label: "Other",
    hint: "Anything else for this person's file",
  },
] as const;

export type DocumentCategoryKey = (typeof DOCUMENT_CATEGORIES)[number]["key"];

export const DOCUMENT_CATEGORY_KEYS: DocumentCategoryKey[] =
  DOCUMENT_CATEGORIES.map((c) => c.key);
