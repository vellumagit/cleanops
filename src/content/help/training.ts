import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "training",
  title: "Training",
  blurb: "Building training modules with text, photos and videos, assigning them to new hires, and tracking who has finished.",
  section: "Your team",
  paths: ["/app/training", "/app/training/new", "/app/training/[id]", "/app/training/[id]/edit"],
  keywords: ["onboarding", "SOP", "procedure", "course", "module", "lesson", "how-to", "certification", "WHMIS", "video", "orientation", "standards"],
  body: `
**Training** is where you write down how your company does things, such as a kitchen deep clean, your safety rules, or how to use the app, as step-by-step modules your team works through on their phones. It sits under **Hiring** in the sidebar. Owners, admins and managers can create modules and track progress.

Training is what someone works through after you've hired them. Interview questions and hiring checklists belong in the hiring library instead (see [Hiring](help:hiring)).

## Creating a module

1. Go to **Training** and click **New module**.
2. Under **Module details**, give it a **Title** and a short **Description**. The description is shown to employees before they start.
3. Under **Who is this for?**, tick every level it applies to: **Employees & contractors** (the field crew, on payroll or on statements), **Managers**, and **Admins & owners**. At least one is required. Each level only ever gets its own modules, so a new manager receives the manager onboarding, not the bathroom checklist.
4. Tick **Assign to every new hire automatically** if this is onboarding material (see below).
5. Click **Add section** for each step and fill it in (see below). Use the arrows to reorder sections, and the trash icon to remove one.
6. Click **Save & publish**, or **Save as draft** to keep working on it later.

Each section has four parts:

- **Section title**, like "Degrease the stovetop".
- **Section body**: what to do.
- **Link** (optional): paste a YouTube or Vimeo address and the video plays inside the step on the cleaner's phone. Any other link, such as a supplier's data sheet or a Google Doc, opens in a new tab. A link has to start with http:// or https://, or it isn't saved.
- **Reference image** (optional): a PNG, JPEG or WebP photo. Phone photos are shrunk before upload; a photo still over 4 MB is refused.

## Assigning training

A module lands on someone's training list automatically when they join, as long as all of these are true:

- **Assign to every new hire automatically** is ticked,
- the module is **published** (drafts are never auto-assigned), and
- the person's level is one of the module's **Who is this for?** levels.

It happens whether they came through the Hire button on Applicants or a plain invite from Employees, and also when someone rejoins through a new invitation. A returning person never gets a duplicate, and their past completions are kept.

People who were already on the team when you created the module aren't assigned it automatically. You can record their training on the module's page, below.

## Tracking who's done it

There are three places to look:

- **The Training page** lists every module with its section count, how many people have completed it out of how many it's assigned to, and whether it's **Published** or **Draft**. Under that, **By employee** lists each active person with how many of their modules they've completed, and links to anything still outstanding.
- **A module's page** (click its name) shows **Employee completions**: everyone at the module's levels, plus anyone outside them who already has it assigned. Each person shows **Completed** with a date, **In progress** with how many steps they've done, or **Not assigned yet**.
- **An employee's file** under Employees has a **Training** section with the same information for just that person.

### Marking someone trained by hand

On a module's page, **Mark trained** records someone as complete without them tapping through it. Use it for staff trained before you started using Sollos, people added without a login who were trained in person, or anyone you've checked yourself. **Undo** turns it back to not complete. The module then stays on that person's training list in the field app for them to work through.

## Editing and deleting

Open a module and click **Edit module**, or use the pencil on the Training list. Saving replaces all the module's sections, so anyone partway through a module starts their ticks again. People who already finished stay finished.

The trash icon on the Training list deletes a module and its sections after you confirm. It can't be undone.

## What cleaners see

In the field app, cleaners open **Profile → Training modules** to see what's assigned to them, with progress for each one. Inside a module, each step shows its text, photo and video or link, and they tap the circle beside a step when it's done. Ticking the last step marks the whole module complete, and that's what you see on the Training page and their file.

## Common questions

**How do I assign a module to someone already on my team?** Automatic assignment only happens when someone joins. For someone already on the team, open the module, click **Mark trained** next to their name, then **Undo**. The module is then on their list in the field app, not yet complete. If they're already trained, just leave it at Mark trained.

**I created a module but my new hire doesn't have it.** Check three things on the module: it's published, not a draft; **Assign to every new hire automatically** is ticked; and their level, such as Employees & contractors, is ticked under **Who is this for?**. Modules are assigned at the moment someone accepts their invite, so a module created after they joined won't appear on its own.

**Can I put a video in a module?** Yes. Paste a YouTube or Vimeo link into a section's **Link** box and it plays inside the step on the cleaner's phone.

**Can managers build training?** Yes. Owners, admins and managers can create, edit and track modules. Employee files, linked from **By employee**, open for owners and admins only.

**Does editing a module wipe everyone's progress?** Anyone who already completed it stays complete. Anyone partway through has their step ticks cleared, because saving replaces the sections.

**Someone was trained before we used Sollos. Do they have to click through everything?** No. Open the module and click **Mark trained** next to their name.
`,
};
