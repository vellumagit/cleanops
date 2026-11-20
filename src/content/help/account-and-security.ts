import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "account-and-security",
  title: "Account and security",
  blurb: "Two-step sign-in, your Sollos subscription, the audit log, exporting or deleting your data, and suspended workspaces.",
  section: "Settings & connections",
  paths: ["/app/profile/security", "/app/settings/billing", "/app/settings/audit-log", "/app/settings/data"],
  keywords: ["mfa", "2fa", "two-factor", "authenticator", "password", "subscription", "plan", "trial", "upgrade", "cancel", "payment failed", "promo code", "audit", "history", "who changed", "export", "backup", "delete account", "close account", "suspended"],
  body: `
This guide covers the account side of Sollos: protecting your own sign-in, paying for Sollos itself, seeing who changed what, and taking your data with you.

## Two-step sign-in

Two-step sign-in (multi-factor authentication) asks for a 6-digit code from an authenticator app on your phone every time you sign in with your password. It's optional and off by default, and it's set per person — turning it on protects your login only. It's available to owners, admins, and managers, and recommended for owners and admins.

To turn it on:

1. Open [Security](/app/profile/security) — owners and admins find it in **Settings → Security (your account)**.
2. Press **Enable multi-factor authentication**.
3. **Step 1** — scan the QR code with an authenticator app (Authy, Google Authenticator, 1Password, Microsoft Authenticator, and so on). If you can't scan, open *Can't scan? Enter the code manually* and type the code into the app.
4. **Step 2** — enter the 6-digit code the app shows and press **Confirm**.

The page then reads *Multi-factor authentication is ON*. From then on, after your password you'll see **Verify your sign-in**: enter the current code and press **Continue**. **Sign in as someone else** on that screen signs you out. The check covers every office page and action, so a password alone can't do anything in your company.

To turn it off, press **Remove** next to the authenticator under **Active authenticators** and confirm. You'll sign in with just your password until you set it up again.

> Sollos has no backup codes. Before you change phones, move your authenticator app's accounts to the new phone (most apps can), or remove two-step sign-in here and set it up again on the new phone. If the phone is already gone, email support@sollos3.com from your sign-in address.

## Your Sollos subscription

[Settings → Billing](/app/settings/billing) (owners and admins) shows your plan, its status, when it renews (or cancels), and when your trial ends.

- **Plans** — Starter (up to 3 cleaners), Team (up to 10), Growth (up to 25), and Enterprise (25 or more, priced by quote — **Contact sales**). Prices are on the page.
- **Starting** — a new company gets a 14-day free trial with no card needed. Press **Start Team trial** (or **Start** on another plan) to subscribe.
- **Changing your plan, card, or cancelling** — press **Manage in Stripe**. Upgrades and downgrades are prorated automatically, and that's also where you download Sollos invoices and update your payment method.
- **Promo code** — type it under **Promo code** and press **Redeem**.

If the page says *Billing isn't switched on for this workspace yet*, nothing there will charge you.

If you're at your plan's cleaner limit, adding or reactivating a cleaner is refused until you move to a bigger plan.

### When the trial ends or a payment fails

- During the trial, a banner counts down the days left; it turns amber in the last three.
- If a renewal payment fails, a red banner gives you seven days to update your card (**Update card**).
- When the trial runs out without a subscription, or the seven days pass, the office is replaced by a lock screen. Owners and admins can subscribe or update the card there, and **Download all your data**. Everyone else is told to ask an owner or admin. Nothing is deleted — every record is waiting when billing is sorted out.

Your cleaners aren't locked out: the field app keeps working the whole time.

## The audit log

[Settings → Audit log](/app/settings/audit-log) (owners and admins) is a record of sensitive changes across your company that can't be edited or deleted: who created, updated, deleted, changed the status of, converted, marked paid, assigned, invited, or deactivated what, and when. Changes Sollos made on its own show **system** as the actor.

- It opens on the most recent 200 events.
- Filter with **Action**, **From**, and **To**, then **Apply** — a filtered view goes back up to 2,000 matching events. **Clear** removes the filters.
- **Export CSV** downloads the rows you're looking at, ready to attach to a "who changed this?" question.

Times are shown in your company's time zone, in the page and in the export.

## Your data

[Settings → Your data](/app/settings/data) (owners and admins).

**Export everything** — **Download export** gives you one file with every record your company holds in Sollos: bookings, clients, invoices, employees, payroll, chat messages, contracts, training. It's built fresh each time you press it, can be several megabytes on an established account, and is yours to archive, hand to an accountant, or take elsewhere.

**Deleting your company** — owners only.

1. Under **Danger zone**, press **Delete organization**.
2. Type your company's name exactly as shown and press **Schedule deletion**.
3. The page shows the date it will happen. For 30 days you can press **Cancel scheduled deletion** and nothing is lost.
4. After 30 days every record and file is permanently wiped. This can't be undone.

While deletion is scheduled, automatic billing-cycle invoices stop being generated. Export your data before the 30 days are up if you want a copy.

## Suspended workspaces

If a company is suspended, its members see *This workspace is suspended*: signing in, sending, and the API are closed for it. Nothing is deleted. If you think it's a mistake, write to support@sollos3.com from the address you signed up with.

If you also belong to another company that isn't suspended, Sollos simply opens that one.

## Signing out

On a computer, use the small arrow button on your name card at the bottom of the sidebar. On a phone, open **More** and tap **Sign out**.

## Common questions

**How do I turn on two-factor authentication?** **Settings → Security (your account) → Enable multi-factor authentication**, scan the QR code with an authenticator app, and enter the 6-digit code.

**I got a new phone and can't get past the code screen.** There are no backup codes. Email support@sollos3.com from your sign-in address. Next time, move the authenticator app to the new phone before you wipe the old one.

**How do I cancel my Sollos subscription?** **Settings → Billing → Manage in Stripe**, then cancel there. The page then shows when it cancels instead of when it renews.

**What happens to my data if I stop paying?** Nothing is deleted. The office is locked until someone subscribes, the field app keeps working, and owners and admins can still download a full export from the lock screen.

**Who changed this invoice?** Open **Settings → Audit log**, filter by date (and action, if you know it), and look for the record in the Entity column.

**Can an admin delete the company?** No. Admins can export, but only an owner can schedule or cancel deletion.

**Can I get my data out without deleting anything?** Yes — **Settings → Your data → Download export** at any time.
`,
};
