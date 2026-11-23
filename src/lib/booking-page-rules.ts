/**
 * A company's booking page (sollos3.com/book/<name>): the rules for its
 * name and for how a service's price is shown. Pure, so they are tested
 * without a database; the lookups are in lib/booking-page.ts.
 *
 * A company has no page until it makes one in Settings, Online booking
 * (docs/online-booking-roadmap.md, "Nothing is created automatically").
 */

/** Names nobody may claim: they would read as Sollos itself, or as a page. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "sollos", "sollos3", "admin", "administrator", "api", "app", "apps", "auth", "billing", "blog", "book",
  "booking", "bookings", "client", "clients", "contact", "dashboard", "demo", "docs", "example", "field",
  "help", "home", "info", "invoice", "invoices", "login", "logout", "mail", "new", "null", "owner", "pay",
  "payment", "payments", "pricing", "privacy", "root", "security", "settings", "signin", "signup", "staff",
  "status", "support", "system", "terms", "test", "undefined", "www",
]);

export const NAME_MIN = 3;
export const NAME_MAX = 60;

/**
 * What someone typed, turned into the form a link can carry: lower case,
 * spaces and punctuation to single hyphens, accents dropped, no hyphen at
 * either end. "Svit Cleaning Co." becomes "svit-cleaning-co".
 */
export function tidyName(raw: string): string {
  return (raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/-+$/g, "");
}

/** Why this name can't be used, in words for the person, or null. */
export function nameProblem(name: string): string | null {
  if (!name) return "Type a name for your link.";
  if (name.length < NAME_MIN) return `Use at least ${NAME_MIN} letters or numbers.`;
  if (name.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters.`;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return "Use letters, numbers and hyphens only, starting and ending with a letter or number.";
  }
  if (RESERVED_NAMES.has(name)) return `"${name}" can't be used as a link name. Try your company's name.`;
  return null;
}

export type PriceMode = "fixed" | "from" | "hidden";

export const PRICE_MODES: ReadonlyArray<{ value: PriceMode; label: string }> = [
  { value: "hidden", label: "Don't show a price" },
  { value: "from", label: "Show as \"From $X\"" },
  { value: "fixed", label: "Show the price" },
];

export const isPriceMode = (v: unknown): v is PriceMode => v === "fixed" || v === "from" || v === "hidden";

/**
 * How a service's price reads on the public page, or null to show none.
 * A service with no price set shows none whatever the mode: "From $0.00"
 * would be a promise nobody meant to make.
 */
export function publicPrice(mode: PriceMode, priceCents: number | null | undefined, format: (cents: number) => string): string | null {
  if (mode === "hidden" || priceCents == null || priceCents <= 0) return null;
  return mode === "from" ? `From ${format(priceCents)}` : format(priceCents);
}
