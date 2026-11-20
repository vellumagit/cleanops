import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "inventory",
  title: "Inventory",
  blurb: "Keeping count of supplies and equipment, reorder levels, and the low-stock alerts and restock tasks.",
  section: "Scheduling & jobs",
  paths: ["/app/inventory", "/app/inventory/new", "/app/inventory/[id]/edit"],
  keywords: ["supplies","stock","equipment","chemicals","reorder","low stock","restock","vacuum","products"],
  body: `
**Inventory** is a simple count of what you keep on hand — cleaning products, chemicals, vacuums — with a reorder level for each, so you hear about it before you run out. The counts are kept by hand: Sollos doesn't take supplies off when a job is done.

## Adding an item

From **Inventory**, press **New item** (or [add one here](/app/inventory/new)):

- **Name** — e.g. "Glass cleaner".
- **Category** — **Consumable**, **Chemical** or **Equipment**.
- **Assigned to** — optional: the person who looks after it (say, whoever has the van kit). They're the one given a restock task when it runs low.
- **Quantity** — how many you have now, in whole units.
- **Reorder threshold** — flag low stock at or below this number. At 0, the item is only flagged once it's run out, and the office isn't sent an alert for it.
- **Notes** — supplier, size, where it's kept.

## The inventory list

The list shows each item's **Item**, **Category**, **Assigned to**, **Stock** (quantity / threshold) and **Status**: **Reorder** in red when the quantity is at or below the threshold, otherwise **In stock**. Search at the top.

To update a count, click the item, change **Quantity**, and save. Deleting is at the bottom of the same page, after a confirmation.

On the list, the **New item** button and opening an item are shown to owners and admins.

## When stock runs low

Two things can happen when stock is low:

- **The office** — when a save takes an item from above its threshold to at or below it, owners, admins and managers get a *Low stock* notification (*Glass cleaner is at 2 units*), linked to Inventory.
- **The person it's assigned to** — gets a *Restock: [item]* task, with a notification, so it's on their list (in the field app under **My tasks** for a cleaner). This happens when the item is added already low, when a save takes it down to its threshold, or when a low item is assigned to someone new. There's only ever one open restock task per item and person.

Ticking the restock task off doesn't change the count — update the item's quantity once the new stock is in. See [Tasks & reminders](help:tasks).

## Common questions

**Why didn't I get a low-stock alert?** The office alert fires when an item's quantity is saved going from above its threshold to at or below it. Adding a new item that's already low, or saving one that was already low, doesn't alert the office again. A threshold of 0 never alerts the office.

**Does Sollos count supplies used on jobs?** No. Quantities only change when you edit them.

**Who gets the restock task?** Whoever the item is assigned to. Items with nobody assigned only alert the office.

**Can cleaners update inventory?** Not in the field app. Inventory is updated by the office.
`,
};
