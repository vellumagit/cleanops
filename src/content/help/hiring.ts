import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "hiring",
  title: "Hiring",
  blurb: "Getting applications in from your website, the applicant pipeline, interview questionnaires, hiring procedures, and the Hire button.",
  section: "Your team",
  paths: ["/app/hiring", "/app/applicants", "/app/applicants/[id]"],
  keywords: ["recruit", "recruiting", "job application", "apply", "applicant", "interview", "candidate", "careers", "hiring form", "job posting", "onboarding"],
  body: `
Hiring has its own lane in the sidebar, with three pages that follow how you bring someone on:

- **Applicants**: the people who applied, moving through a pipeline from New to Hired or Rejected.
- **Hiring**: your library of interview questionnaires and hiring procedures. It's what you work *from* before you say yes.
- **Training**: what a new person works *through* after you say yes. That has its own guide, [Training](help:training).

Applicants and Hiring are for owners and admins only.

## Getting applications in

Sollos doesn't host a job application page of its own. Applications come from a form on your website (or Typeform, Jotform, Zapier and the like) that sends to a Sollos intake address:

1. Go to [Settings → Website & lead forms](/app/settings/intake-forms).
2. Create a new intake form and set its type to **Job application**.
3. Copy its URL and set it as the address your website's application form submits to.

Every submission lands on **Applicants** as **New**. Sollos picks up common field names for name, email, phone, the position applied for, experience, availability, a message or cover letter, and a resume link. Anything else the form sends is kept too, under **Other form fields** on the applicant's page, so nothing is lost. More on intake forms, including how to keep the address safe, is in [Website forms](help:website-forms).

The number beside **Applicants** in the sidebar is how many are still New.

To add someone who applied in person or by phone, click **Add applicant** on the Applicants page. Only the name is required; email, phone, **Applying for** and notes can be filled in as you learn them.

## The applicant pipeline

Every applicant sits in one stage: **New**, **Reviewing**, **Interview**, **Hired** or **Rejected**. The chips across the top of Applicants filter by stage and show how many are in each. Change a stage from the dropdown on each row, or with the **Stage** buttons on the applicant's page.

An applicant's page shows everything they sent: contact details you can tap to email or call, a **Resume / link** button when they sent one, experience, availability, their message, and when it arrived. Alongside are **Internal notes**, which only your team sees (click **Save notes**), and **Delete applicant**. Delete removes them straight away, with no confirmation, so use the Rejected stage if you might want the record later.

## The hiring library

The **Hiring** page holds two kinds of documents, both written the same simple way: a title, then one item per line, plus optional notes.

- **Interview questionnaires**: the questions you ask, so every candidate gets the same interview and comparing them is fair. Create one with **New questionnaire**.
- **Hiring procedures**: the steps from yes to first shift, like collecting documents, signing the contract, setting the pay rate and assigning training. Create one with **New procedure**.

Click a document to expand its numbered list. Each has an **Edit** button and a trash button. The trash button deletes the document as soon as you click it.

## Recording an interview

On an applicant's page, pick a questionnaire under **Run an interview** and click **Start**. The questions are copied onto the applicant with an answer box under each, plus a notes box for anything off-script. Type as they talk, then click **Save answers**.

Because the questions are copied in, editing the questionnaire later never changes an interview you've already recorded. A second round, say a phone screen and then an in-person interview, is just another **Start** under **Another round**. **Delete interview** removes one; its answers can't be recovered.

Starting an interview doesn't change the applicant's stage. Move them to **Interview** yourself if you want the pipeline to show it.

## Hiring someone

When you've said yes, open the applicant's page and click **Hire** (the button carries their first name). One dialog, with nothing to retype:

1. **Name** and **Email** come from the application. Check the email, because that's where the invite goes.
2. Choose **Paid as**: **Employee (payroll)** or **Subcontractor (statements)**.
3. Enter their **Hourly wage**, or leave it blank and set it on their profile later.
4. Click **Send invite & mark hired**.

Sollos sends a team invitation and stamps the applicant **Hired**. The dialog shows the invite link either way, and if the email didn't go out it says why so you can send the link yourself. When they accept, their account is created with the wage and engagement already set. Any published training marked **Assign to every new hire automatically** lands on their list at the same moment.

Hires from here always join as the Employee role, meaning field staff. To make someone a manager or admin, an owner changes their role afterwards under Employees. Accepting the invite, plan limits and everything after that is in [Employees & team members](help:employees).

Once an applicant is Hired or Rejected, the Hire button no longer appears. Their employee file later shows when they applied and when they were hired, matched by email.

## Common questions

**Where do I get a link for people to apply?** Sollos doesn't host an application page. Create a **Job application** intake form under **Settings → Website & lead forms** and point your website's application form at its URL. Submissions then land on Applicants.

**An application came through but some answers are missing.** Fields Sollos doesn't recognise by name aren't dropped. Open the applicant and expand **Other form fields** at the bottom.

**I hired someone but they never got the email.** The Hire dialog shows the invite link after you hire. Copy it and text it to them. The invite also sits under **Pending invitations** on Employees, where you can copy it again or revoke it. Invite links expire after 14 days.

**Can I hire someone as a manager straight from Applicants?** No, hires from Applicants join as field staff. An owner can change their role under Employees once they've joined.

**If I edit a questionnaire, do old interviews change?** No. Each interview keeps the questions exactly as they were asked.

**Does a new application notify me?** Sollos doesn't send a notification for new applicants. The count beside **Applicants** in the sidebar shows how many are waiting as New.

**I marked someone Hired with the stage buttons. Did that invite them?** No. Only the **Hire** button sends an invite. Changing the stage by hand just records where they are in your process.
`,
};
