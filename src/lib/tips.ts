/**
 * The tips & shortcuts registry — every "hack" the app supports, written
 * down once, rendered everywhere.
 *
 * Born from Brian discovering select type-ahead by accident after weeks of
 * scrolling: "I was so pissed before, and that was fucking awesome. And I
 * had no clue that you even built that." A capability nobody knows about
 * is a capability that doesn't exist. Each entry here feeds two surfaces:
 * the master list in Settings → Tips & shortcuts, and the little lightbulb
 * chips that sit next to the controls themselves (toggleable, on by
 * default).
 *
 * Rules for entries: only REAL, currently-true behaviors — a tip that lies
 * once poisons trust in all of them. Short enough to read in three
 * seconds. Say the action, not the architecture.
 */

export type TipEntry = {
  key: string;
  title: string;
  body: string;
};

export const TIPS: TipEntry[] = [
  {
    key: "select-typeahead",
    title: "Type to jump",
    body: "In any dropdown, press a letter to jump to entries starting with it. Keep pressing the same letter to cycle — R, R, R walks through every client starting with R.",
  },
  {
    key: "invoice-search",
    title: "Search knows invoice numbers",
    body: "The invoices search matches client names AND invoice numbers — typing 0127 lands straight on INV-2026-0127.",
  },
  {
    key: "batch-billing",
    title: "Bill several jobs on one invoice",
    body: "New invoice → pick the client → \"Bill them together\" lists every unbilled job in a date range on one invoice. Old DRAFT invoices for those jobs get folded in and voided automatically; sent or paid ones are never touched.",
  },
  {
    key: "period-amounts",
    title: "Batch amounts are editable",
    body: "Every line in the batch editor is editable before you create the invoice — fix a price right here without going back to the booking.",
  },
  {
    key: "client-prefill",
    title: "Invoices arrive prefilled",
    body: "Starting a new invoice from a client's page fills in the client — and if they have exactly one unbilled job, the job and amount too.",
  },
  {
    key: "attach-chips",
    title: "Stray hours reattach in one tap",
    body: "A blue \"Looks like…\" chip on a timesheet row means those off-job hours overlap a job that person was assigned to. One tap files the hours onto the job.",
  },
  {
    key: "clock-one-tap",
    title: "Cleaners clock in with one tap",
    body: "The field clock shows each cleaner's jobs for today as buttons — one tap clocks them in attached to the job. No more picking categories for job work.",
  },
  {
    key: "rows-are-doors",
    title: "Rows open records",
    body: "On most lists — invoices, bookings, clients — clicking anywhere on the row opens the record. No need to hunt for a link.",
  },
  {
    key: "esc-closes",
    title: "Esc closes dialogs",
    body: "Any popup or dialog closes with the Esc key — faster than reaching for the X.",
  },
];

export function tipByKey(key: string): TipEntry | undefined {
  return TIPS.find((t) => t.key === key);
}
