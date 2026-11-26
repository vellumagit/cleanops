import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "reviews",
  title: "Reviews",
  blurb: "Collecting star ratings from clients, adding reviews by hand, Google review requests, and where ratings show up.",
  section: "Clients & sales",
  paths: ["/app/reviews", "/app/reviews/new"],
  keywords: ["rating", "stars", "feedback", "testimonial", "google review", "review request", "customer satisfaction", "low rating"],
  body: `
Reviews are star ratings (1 to 5) and comments from your clients. Each review is credited to the cleaner who did the job. Reviews show on the client's profile and feed per-employee scores and bonus rules (see [Bonuses](help:bonuses)). Separately, Sollos can ask happy clients to leave a public Google review.

The **Reviews** page is under sidebar → **People** → **Reviews**.

## Where reviews come from

1. **The review request email.** With **Internal review request** turned on in **Settings → Client messages**, clients get an email with a review link after a completed job.
2. **The client portal.** Every finished visit in a client's portal has a **Leave a review** link, so they can review without being asked (see [The client portal](help:client-portal)).
3. **You add one.** Owners and admins can press **New review** to record a review a client gave you some other way, by phone or in person.

## How often clients are asked

The **Internal review request** automation has a frequency setting: **After every clean (30-day minimum gap)**, **4× a year**, **2× a year**, or **Once a year**. It limits how often a client is asked. Clients can still leave a review from their portal whenever they like.

Like every automation, it's off until you turn it on.

## What the client sees

The review link opens a page with your logo, five stars to tap, and a comment box (up to 2,000 characters). After they submit:

- If they gave **4 or 5 stars** and your Google review link is saved in [Settings → Branding](/app/settings/branding), they're asked to leave a Google review too, with a **Leave a Google Review** button.
- Otherwise they see a thank-you.

Rules the page follows:

- A review can only be left for a **completed** job.
- A review link stops working **60 days** after the job.
- **Sollos keeps one review per visit.** A client can review each finished visit once, whether from the emailed link, the invoice's link or their portal. Opening the link for a visit they've already reviewed shows the review they left, plus a **Share on Google too** button if it was 4 or 5 stars. An invoice that isn't for one visit (a monthly invoice, say) takes one review of its own.
- The review is credited to the cleaner assigned to that job.

## Being told about new reviews

Two automations in **Settings → Client messages** (both off until you turn them on):

- **Notify admin on new review**: an in-app notification to owners and admins for each new review.
- **Low review alert**: an email to owners and admins when a review is 3 stars or lower, with the full text, so you can respond quickly.

## Google review requests

**Google review request** (also in **Settings → Client messages**) emails a client your Google review link 48 hours after their first completed job. If they don't click, they get a reminder a week later, then monthly reminders until the limit (four more by default). It stops as soon as they click. It needs your Google review link in [Settings → Branding](/app/settings/branding) and an email on the client. It only asks clients whose first completed job was within the last 14 days, so turning it on doesn't email clients you've had for months.

Each client's profile has a **Google review status** panel that shows where they are and lets you **Mark reviewed**, **Stop asking**, **Resend now**, or **Reset** (see [Clients](help:clients#google-review-status)). When you add a client, you can tick **This customer has already left us a Google review** so they're never asked.

## The Reviews page

The list shows each review's client, the employee it's credited to, the stars, the comment, the date it was submitted, and the score. Filter with **Employee** and **Min rating** (**5 stars**, **4+ stars**, **3+ stars**, **2+ stars**), or search by client, employee, or comment.

## Adding a review by hand

1. On [Reviews](/app/reviews), press **New review**.
2. Pick the **Booking** if the review is about a specific completed job. That fills in the client and the cleaner for you.
3. Otherwise pick the **Client** and, if you like, the **Employee**.
4. Enter the **Rating (1–5)** and an optional **Comment**.
5. Press **Add review**.

## Editing or deleting a review

Owners and admins see a pencil on each row. It opens **Edit review**, where you can change the stars or the comment, or delete the review. Deleting can't be undone.

## Common questions

**Why isn't anyone getting review emails?** **Internal review request** has to be turned on in **Settings → Client messages**, and the client needs an email address. A client set to **Do not contact**, or with **Reviews & rebooking** turned off in their notifications, isn't emailed either.

**A client says the review link doesn't work.** Links stop working 60 days after the job. Links only work for completed jobs. If the client has already left a review, the page shows that review instead of a new form.

**Can a client leave more than one review?** Yes, one for each visit. They can't review the same visit twice: that visit's link shows the review they already left. You can add more by hand with **New review**.

**Why didn't the client get asked for a Google review?** Your Google review link must be saved in **Settings → Branding**, the client needs an email, and **Google review request** must be on. Check their **Google review status** panel too: it may say they clicked, opted out, or were marked reviewed.

**Can I change a bad review?** Owners and admins can edit or delete any review from the Reviews page. Remember these reviews feed employee scores and bonuses.

**Who gets credit for a review?** The cleaner assigned to the job the review link came from. For a review you add by hand, whoever you pick as **Employee**.
`,
};
