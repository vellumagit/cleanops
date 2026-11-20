import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "contracts",
  title: "Contracts",
  blurb: "Recording a service agreement with a client, sending it for e-signature, and what happens once it's signed.",
  section: "Clients & sales",
  paths: ["/app/contracts", "/app/contracts/new", "/app/contracts/[id]/edit"],
  keywords: ["agreement", "service agreement", "e-sign", "esignature", "sign online", "retainer", "terms"],
  body: `
A contract records an ongoing agreement with a client: what service, from when to when, the agreed price, and the payment terms. You can send it to the client to sign online. A contract is a record and a signature. It doesn't create bookings or invoices by itself, so you still set those up as usual (see [Recurring series](help:recurring-series) and [Billing cycles](help:billing-cycles)).

Contracts are under sidebar → **Operations** → **Contracts**. Owners, admins, and managers can see them. On the Contracts list, the **New contract** button and clicking into a contract are for owners and admins.

## Creating a contract

1. On [Contracts](/app/contracts), press **New contract**.
2. Pick the **Client**. Archived clients aren't listed.
3. Optionally pick a **Linked estimate**: the estimate this contract came from.
4. Pick the **Service**. Only cleaning services are listed (the standard, deep, move-out, and recurring categories), not appointments such as walkthroughs. If none are listed, add one in [Settings → Services](/app/settings/services).
5. Set the **Status** (**Active**, **Ended**, or **Cancelled**), the **Start date**, and optionally an **End date**. Leave the end date blank for an open-ended agreement.
6. Enter the **Agreed price** and any **Payment terms**, for example "Net 15, monthly invoice on the 1st".
7. Press **Create contract**.

The status is yours to set. Sollos doesn't end a contract automatically on its end date.

## Sending it for signature

Open the contract. Under **E-signature**, press **Send for signature**. Sollos creates a signing link and emails it to the client. The link is shown on the page too, with **Copy** and **Open**, so you can text it or send it yourself. Anyone with the link can view and sign it, so only share it with the person who should sign.

If the client has no email on file, or the email doesn't go out, the link is still created and the page tells you to share it yourself.

The button then reads **Regenerate link** (or **Resend link** once it's signed). It sends the same link again rather than making a new one, so a link the client already has keeps working. A **Cancelled** contract can't be sent. Set it back to **Active** first.

## What the client sees and does

The signing page shows your company name, the service, **Between** your company **and** the client, the **Start date**, **End date** (or "Open-ended"), **Agreed price**, and **Payment terms**. To sign, the client:

1. Types their **Full legal name**.
2. Optionally draws their signature.
3. Ticks the agreement box, which explains that their typed name, the date, and their IP address are recorded as evidence.
4. Presses **Sign contract**.

They then see **Contract signed**, with their name and the date.

The files in the contract's **Documents** section aren't shown on the signing page. The client signs the terms listed above.

## Once it's signed

- Owners, admins, and managers get a "Contract signed" notification.
- The **E-signature** section shows **Signed by** the client's name and the date and time, plus their drawn signature if they made one.
- The terms are locked: client, linked estimate, service, dates, price, and payment terms can't be changed. You can still change the **Status**. For new terms, make a new contract.

If you cancel a contract after sending it, the link still opens but the client can no longer sign it.

## Documents

Each contract has a **Documents** section for files that belong with it: a full agreement, a scope of work, a floor plan. Upload PDF, Word, Excel, or image files up to 20 MB each. Owners, admins, and managers can add and delete them. These files are separate from the **Contracts & agreements** folder on the client's profile (see [Clients](help:clients#documents-and-photos)).

## Deleting a contract

**Delete contract** is under **Danger zone** on the contract's page. It removes the contract and its documents permanently. A client who has contracts on record can't be deleted until those contracts are deleted.

## Common questions

**I need to change the price on a signed contract.** You can't. The terms are locked once it's signed. Set the old one to **Ended** and create a new contract with the new terms.

**The client never got the signing email.** The **E-signature** section says whether the email went out. Either way, copy the signing link from that section and send it yourself.

**Does Regenerate link stop the old link working?** No. It sends the same link again.

**Does a contract create bookings or invoices?** No. It records what was agreed. Set up the recurring bookings and the client's billing settings yourself.

**Can my manager create contracts?** The **New contract** button and opening contracts from the list are for owners and admins.

**Can the client decline the contract?** There's no decline button on the signing page. A client who doesn't want to sign simply doesn't. Set the status to **Cancelled** if the agreement is off.
`,
};
