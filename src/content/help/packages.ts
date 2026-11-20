import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "packages",
  title: "Packages",
  blurb: "A list of the service bundles you offer, each with a price, a length, and what's included.",
  section: "Clients & sales",
  paths: ["/app/packages", "/app/packages/new", "/app/packages/[id]/edit"],
  keywords: ["bundle", "service package", "price list", "menu", "offerings", "what's included"],
  body: `
A package is a service bundle you offer, such as "Move-out deep clean" or "Weekly standard, 3 bed". Each one has a price, a length, and a list of what's included. The Packages page keeps them in one list your team can refer to when quoting or answering "what do you offer?"

Packages isn't in the sidebar. Open it at [Packages](/app/packages).

## What a package holds

- **Name**.
- **Description**.
- **Duration**: how long the job takes.
- **Price**, in dollars.
- **What's included**: one item per line, or separated by commas, for example "Kitchen deep clean", "Bathrooms", "Vacuum & mop".
- **Active and visible to your team**: untick it to keep a package you no longer offer without deleting it. The list shows it as **Inactive**.

## Adding and editing packages

1. On the Packages page, press **New package**.
2. Fill in the name, duration, and price. The description and what's included are optional.
3. Press **Create package**.

To change one, click it in the list, edit, and press **Save changes**. The list shows each package's name, description, duration, how many items it includes, whether it's active, and its price. Search with the box above the list.

Everyone on the team can open the Packages page. The **New package** button and clicking a package to edit it are for owners and admins.

## What packages are and aren't connected to

Packages are a reference list. The booking form, estimates, and invoices don't pick from them, so a package's price doesn't fill in anywhere by itself. Copy the price into the booking or estimate yourself. For the services you pick on bookings, see **Settings → Services**.

The one connection: bookings created through the Sollos API can be tied to a package (see [API and webhooks](help:api-and-webhooks)). A package tied to bookings can't be deleted until those bookings are moved off it.

## Deleting a package

**Delete package** is under **Danger zone** on the package's page and can't be undone. To stop offering a package but keep its record, untick **Active and visible to your team** instead.

## Common questions

**Where is Packages in the menu?** It isn't in the sidebar. Go to the Packages page by its address.

**Does choosing a package on a booking set the price?** The booking form doesn't offer packages. Enter the booking's price yourself.

**Why won't my package delete?** Bookings are tied to it. Make it inactive instead, or move those bookings off it first.

**What's the difference between a package and a service?** Services (**Settings → Services**) are what you pick on every booking. They drive the calendar colour, reports, and checklists. Packages are a separate list of bundles with a price and what's included, kept for reference.
`,
};
