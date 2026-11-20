import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "feedback",
  title: "Feedback",
  blurb: "Reporting a bug, asking for something, or asking a question — and how to tell whose turn it is.",
  section: "Start here",
  paths: ["/app/feedback", "/app/feedback/new", "/app/feedback/[id]"],
  keywords: ["bug", "report a problem", "support", "contact", "broken", "feature request", "idea", "help desk", "contact sollos"],
  body: `
**Feedback** is where you tell the Sollos team something is broken, ask for something new, or ask a question — and where they ask you things back. Every item has a status, a history, and a clear answer to "whose turn is it?", which a text message or voice memo never has.

Find it under **Feedback** at the bottom of the sidebar (under **More** on a phone), or from **Report a problem to the Sollos team** at the bottom of the assistant chat.

Feedback is part of the office, so it's for owners, admins, and managers. The field app has no Feedback page; if a cleaner runs into a problem, file it for them and say which cleaner and which job.

## Filing something

Press **New** on the board (or **Report something** when the board is empty). The form asks three things.

**What is it?** — three choices, because they get handled differently:

- **Something's broken** — it did the wrong thing, or nothing at all.
- **I wish it did this** — nothing is broken, it should just work differently.
- **I have a question** — how does this work, or what should I do here?

**In one line** — a short summary (required).

**Anything else** — optional detail: what you expected, what happened instead, and which client or job it was on. Rough is fine — detail just saves a round trip.

Press **Send**. You land on the item's own page, where the thread lives.

Two things are attached automatically: **which version of the app you were on** and **what device you were using**. When you start from **Report a problem** in the assistant, **the page you were on** is attached too. The form tells you what's being sent. Those details are often the difference between a bug being reproduced in a minute and a week of "which screen was it on?"

The form refuses anything that looks like a card number, so a payment detail pasted by accident never gets stored.

## Who hears about it

- **The Sollos team** — every new item is emailed to support@sollos3.com with your email as the reply-to, so an answer can reach you by email as well as on the board. Follow-ups you post on your own items are emailed too (up to ten emails a day per person; everything still lands on the board).
- **Your owners and admins** — get a notification when someone else in the company files an item or follows up on one.
- **You** — get a notification when someone else posts a reply on an item you filed.

## Whose turn is it

The board is sorted by whose turn it is:

- **Needs your answer** — at the top, in amber. Sollos is blocked and can't move until someone in your company replies.
- **With Sollos** — sent and waiting on the Sollos team. These items show the status *Open*.
- **Being built** — picked up and under way.
- **Done** — items marked *Shipped* (live in the app) or *Closed* (not a bug, or not something being done).

Each row shows the kind, who filed it, when it last moved, the page it came from, and how many replies it has.

## Replying

Open an item, type in **Reply**, and press **Post reply**.

Replying to an item that says *Needs your answer* hands it back to Sollos automatically — answering **is** the hand-back, you don't have to change anything else.

Under the reply box, **Then set to** lets you move the item in the same step, for example to *Shipped* once you've confirmed a fix works, or to *Closed* if it's no longer needed. When the item was waiting on you, it's already set to *Open* (back with Sollos), which is what almost every reply means.

> The assistant chat is not a reporting channel. Conversations aren't saved, and nobody replies there. When you tell the assistant something is broken or confusing, a short note may be passed to the team, but if you want an answer, file it here.

## Common questions

**How do I report a bug?** **Feedback → New**, choose **Something's broken**, write one line, add what happened if you can, and press **Send**. Or use **Report a problem to the Sollos team** at the bottom of the assistant, which attaches the page you were on.

**How will I know when Sollos answers?** Check the board: anything waiting on you sits at the top under *Needs your answer*. A reply posted on the board notifies whoever filed the item, and because the email to Sollos uses your address as the reply-to, they can also answer you by email.

**An item says Needs your answer. What do I do?** Open it, answer the question in **Reply**, and press **Post reply**. It goes back to Sollos on its own.

**Can my cleaners report problems?** Not directly — Feedback isn't in the field app. File it for them and include the cleaner's name, the job, and what they saw.

**Can I close an item myself?** Yes. Owners, admins, and managers can pick *Closed* (or any status) in **Then set to** when they post a reply.

**I told the assistant about a bug. Has Sollos got it?** Possibly a short note, but nobody will reply in the chat and it isn't saved. File it in Feedback to get a thread and an answer.
`,
};
