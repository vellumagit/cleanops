import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "assistant",
  title: "Asking the assistant",
  blurb: "What the Sollos Assistant can answer, what it can't do, and how to open it.",
  section: "Start here",
  paths: [],
  keywords: ["ai", "chatbot", "chat bot", "sparkle", "ask", "assistant", "help bot", "sollos assistant"],
  body: `
The **Sollos Assistant** answers questions about how Sollos works, in plain words, right where you are. Ask it "how do I stop the reminder texts?" or "where do I set pay periods?" and it answers from these Help guides.

## Opening it

- **On a computer** — the round sparkle button at the bottom right of every office page. Press it again (or the X) to close.
- **On a phone** — the sparkle in the top bar.

Type your question and press Enter (Shift+Enter for a new line). The assistant is in the office only — owners, admins, and managers — not in the field app, and it steps aside on the **Chat** page.

## What it can do

- **Answer from the guides.** It reads the same Help guides you can browse under **Help**, and they update with every release, so its answers match the version you're using. It will often finish by pointing you to the full guide.
- **Know where you are.** It's told which page you're on, so "what does this button do?" has some context.
- **Know a few live numbers** about your company: upcoming bookings in the next seven days, how many clients you have, open tasks, and how many invoices are awaiting payment (that last one only if you're allowed to see invoices). It also knows your name.

## What it can't do

- **It can't change anything.** It can't book, edit, send, or delete — it only explains how you would.
- **It can't see your records.** It doesn't know a particular client, job, or invoice; the few counts above are all it has.
- **It isn't a person, and it can't escalate.** When you say something is broken or confusing, its reply may start with *Feedback noted* and a short copy of the exchange is passed to the Sollos team — but nobody will reply in the chat. To get an answer from a person, use **Report a problem to the Sollos team** under the message box, which opens [Feedback](help:feedback) with the page you were on already attached.
- **It doesn't keep conversations.** The chat stays while you move between pages, and is gone when you reload or close the tab. Nothing is saved.
- **It can be wrong.** It's told never to invent features and to say when it isn't sure, but if its answer and the app disagree, trust the app — and tell us in Feedback.

## Limits

The assistant takes about twenty questions a minute per person, and a single conversation can only get so long. If you hit either limit, it replies *Sorry, something went wrong. Please try again.* Wait a minute, or reload the page to start a fresh conversation.

## Common questions

**Is the assistant a real person?** No. It's an AI that answers from the Help guides. For a person, use **Report a problem to the Sollos team** below the message box, or **Feedback** in the sidebar.

**Can it look up a client or an invoice for me?** No. It can't see individual records — only a few company-wide counts.

**Can it make changes for me, like rescheduling a job?** No. It explains how; you do it.

**Where did my conversation go?** Conversations aren't saved. Reloading or closing the tab starts fresh.

**It said "Sorry, something went wrong."** Usually too many questions in a minute or a very long conversation. Wait a minute or reload the page and ask again.

**Can my cleaners use it?** No — it's only in the office, not the field app.
`,
};
