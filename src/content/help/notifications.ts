import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "notifications",
  title: "Notifications and your profile",
  blurb: "The Notifications page, push notifications on your phone, the alert emails the office gets, and your own name and phone.",
  section: "Start here",
  paths: ["/app/notifications", "/app/profile"],
  keywords: ["bell", "alerts", "push", "phone notifications", "buzz", "no sound", "email alerts", "unread", "mark as read", "profile", "my name", "iphone", "android"],
  body: `
Sollos tells the office about things in three ways: a notification on the **Notifications** page (the bell), a push to phones that have allowed it, and — for the few things that can't wait — an email. This guide covers all three, plus your own profile.

## The Notifications page

Open it from the bell (next to your company name on a computer, in the top bar on a phone) or from **Notifications** at the bottom of the sidebar (under **More** on a phone). The red number is how many you haven't read.

The page shows your latest 100 notifications: the ones sent to you, plus notices for the whole company.

- Unread ones are in bold with a blue dot.
- Click a notification to open what it's about — the job, the invoice, the feedback thread.
- The tick button on the right (**Mark as read**) marks that one read. **Mark all read**, at the top, marks everything read.
- Opening a notification doesn't mark it read by itself; use the tick.

Reading is personal: marking a company-wide notice read clears it for you, not for everyone else.

Owners and admins see **Manage alerts** at the top, which opens **Settings → Team alerts & housekeeping**. That's where the company's team alerts and digests are switched on and off — see [Automations](help:automations).

## Push notifications on your phone

A notification can also buzz your phone, even when Sollos is closed. That has to be turned on once on each phone, by the person who uses it.

**Turning it on in the office:** tap **Turn on** on the blue *Enable notifications* banner at the top of the page. Your phone asks whether to allow notifications — say yes. If you close the banner with the X, it comes back the next time you open Sollos.

**Turning it on in the field app:** go to **Profile → Push notifications** and tap **Notifications off (tap to enable)**. Owners and managers can reach this through **Switch to Field View**; it's also where you turn notifications off again (**Notifications on (tap to disable)**). The office's own profile page has no switch.

### iPhone

Notifications only work from the Sollos icon on your home screen, never from a Safari tab. In Safari tap **Share**, then **Add to Home Screen**, open Sollos from the new icon, and turn them on there.

If you said no once, iPhone won't ask again: open the phone's **Settings**, then **Notifications**, then **Sollos**, and allow them.

### Android

If Sollos says notifications are blocked, they were refused once and the phone won't ask again.

- **Home-screen app** — press and hold the Sollos icon, tap **App info**, then **Notifications**, and turn them on. Then come back and tap again.
- **In Chrome** — tap the icon to the left of the web address, then **Permissions**, then **Notifications**, and choose **Allow**. Then reload the page.

### On a computer

If notifications are blocked in your browser, click the icon to the left of the web address, allow notifications, and reload. Some browsers can't receive notifications at all; for those, **Profile → Push notifications** in the field app says to use Chrome, Safari, or Edge instead.

### Things to know

- **No sound?** Sollos sends the notification; the phone decides whether it makes a sound. Check the phone's notification settings for Sollos (or Chrome), and make sure sound is on and Do Not Disturb is off.
- **Each phone is separate.** A new phone needs it turned on again.
- **Shared phone?** A phone delivers to one person — whoever last opened Sollos on it while signed in.

## Emails the office gets

Most notifications stay in the app and on your phone. A handful are emailed too, because they mean money or work is going wrong and someone has to act even if nobody is looking at the app:

- **Needs you alerts** — a job finished with someone missing, someone not clocked in, someone an hour or more past their hours, and the 6 PM list of tomorrow's problems. See [The dashboard](help:dashboard#alerts-to-your-phone-and-email).
- **A shift was auto-closed** — a forgotten clock-out was capped by Sollos.
- **A job finished with no clock-in** — someone was assigned, the time passed, and nobody clocked in.
- **A pending job's date has passed** — still unconfirmed after its time.
- **A past job was never staffed** — nobody was assigned and the time passed; it was not completed or invoiced.
- **A client asked to skip a visit** — emailed when the skip is too close to the visit to apply automatically and needs your call.
- **Pay period ready for review** and **Payroll is waiting on flagged shifts**.
- **An invoice couldn't auto-send** (owners and admins) — usually a client with no email on file.
- **Unpaid invoices voided automatically** (owners and admins) — only if that automation is on.

Unless marked, these go to every owner, admin, and manager. Some only happen when the automation behind them is on. The email goes to the contact email on your record in **Employees**, or, if there isn't one, the email you sign in with.

Weekly and monthly digests, crew schedules, and other team alerts are switched on in **Settings → Team alerts & housekeeping**.

## Your profile

[Your profile](/app/profile) holds your own **Your name** and **Phone** — how you appear across Sollos, on bookings, the schedule, and to your team, instead of your email address. Change them and press **Save**.

Owners and admins reach it from **Settings → Your profile** (under *Account*). Managers can open it from the link above. Two-step sign-in lives next door — see [Account and security](help:account-and-security).

If someone has filled in a **Full name** for you on your record in **Employees**, that name is what Sollos shows, ahead of the one on your profile.

## Common questions

**Why am I not getting notifications on my phone?** Push has to be turned on once on each phone — tap **Turn on** on the blue banner. On an iPhone it only works from the home-screen icon. If you refused once, follow the iPhone or Android steps above to unblock it.

**The blue banner disappeared but I never turned notifications on.** It hides when you close it (until you next open Sollos), when your phone has blocked notifications, and on an iPhone in a Safari tab. Use **Switch to Field View → Profile → Push notifications**, which says exactly what's in the way.

**Notifications arrive but make no sound.** The phone controls sound. Check its notification settings for Sollos (or Chrome) and that Do Not Disturb is off.

**I read a notification but it's still bold.** Opening it doesn't mark it read. Press the tick next to it, or **Mark all read**.

**My manager marked a notice read — did that clear it for me?** No. Read status is kept per person.

**Which email address do alert emails go to?** The contact email on your record in **Employees**, or your sign-in email if that's blank.

**Why does my name show differently from my profile?** A **Full name** set on your record in **Employees** takes priority over your profile name. Change it there.
`,
};
