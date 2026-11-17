# Final hand test (17 Nov 2026)

Do this on the **Velluma** demo company at sollos3.com. Check the company
name in the top corner says Velluma before pressing anything that sends or
saves. Use your own email and phone wherever a client's is needed.

Each step says what to press and what you should see. If a step does
something else, write down the step number and what happened; it goes on the
pile and gets fixed the same day.

Menu and button names here are from memory of the app, not checked screen
by screen: if a label differs slightly but the thing works, that is a pass.

About 30 to 40 minutes. A computer for sections A, C, D, E; a phone for B.

## A. Office (owner, on a computer)

1. **Sign in.** You land on the dashboard, not an error or a blank page.
2. **New client.** Clients, New client, your own email and phone, save.
   The client opens with the phone shown tidied, e.g. (403) 555-0123.
3. **New booking.** Book that client for tomorrow at 9:00 AM, 2 hours, one
   cleaner. It shows on the schedule tomorrow at 9:00 AM.
4. **Make it weekly.** Edit the booking, set it to repeat weekly, save.
   Next week's visit appears at the same time, same cleaner.
5. **Add a second cleaner** to tomorrow's visit and tick "divide hours
   evenly". The visit now shows 1 hour on the schedule (2 hours of work,
   two people).
6. **Move it.** Drag tomorrow's visit to 11:00 AM. It stays at 11:00 after
   a page reload.
7. **Invoice.** Open the client, create an invoice for $100, send it to
   yourself. The email arrives; its link opens the invoice without signing
   in.
8. **Record a payment** of $40 on that invoice. The balance shows $60 and
   the status reads part-paid.
9. **Estimate.** Create an estimate for the same client, send it to
   yourself. The email arrives; the link opens it.
10. **Task time.** Tasks, new task, due tomorrow at 9:00 AM. Save. Open it
    and save again without changing anything. Open it a third time: it
    still says 9:00 AM. (Before the fix, each save moved the time.)
11. **Announcement.** Send a team announcement. The bell shows it. Press
    "Mark all read": your bell clears. (Step 20 checks it did NOT clear
    for the manager.)

## B. Cleaner (on a phone)

Sign in as one of the Velluma demo cleaners.

12. **Sign in.** You land on the field screen directly, with no flash of
    the office app.
13. **Today's job.** A job assigned to this cleaner today shows with the
    client's name and address. (If there is none, assign one from the
    office first.)
14. **Start the job.** Press Start. The job shows as in progress and the
    clock is running.
15. **Add a photo and a note** to the job. Both show after a reload.
16. **Finish the job.** Press Complete. It shows as done; back in the
    office, the schedule shows it completed.
17. **Someone else's job.** Try to open a job this cleaner is not on (use a
    link copied from the office). You are refused or sent back, not shown
    the job with working buttons.
18. **Time off.** Request a day off next month. The request shows as
    pending. In the office it appears for approval.

## C. Manager (the role Olha has)

Sign in as a Velluma manager.

19. **Edit a booking**, an **estimate** and an **invoice** (change a note
    on each, save). All three save. These are the edits the database
    change on 17 Nov restored for managers.
20. **The announcement from step 11 is still unread** in this manager's
    bell. Press it: it clears for the manager.
21. **Timesheets switch.** As the owner, turn this manager's "Timesheets &
    time off" switch off (Team, the manager, permissions). As the manager,
    the Timesheets page is gone from the menu. Turn the switch back on.

## D. Client

Use a private window so you are not signed in.

22. **Invoice link** from step 7: shows $100 total, $40 paid, $60 owing.
23. **Estimate link** from step 9: press Approve. It shows as approved, and
    the office shows the estimate approved.
24. **Portal.** Open the client portal link for your test client. It shows
    their upcoming visit and their invoice, and nobody else's.

## E. Real outside services

25. **Email:** steps 7 and 9 already proved real email goes out. Check the
    sender name reads as the company, not "Sollos".
26. **Text message:** if texting is on for Velluma, send yourself a visit
    reminder or a test text. It arrives from the company's number. Reply
    STOP, then confirm a second text does not arrive. Reply START to undo.
27. **Google Calendar:** Settings, Integrations, connect a Google account
    you own. Tomorrow's booking appears on that calendar once. Move the
    booking in Sollos; the calendar event moves, with no second copy.
    Disconnect: Sollos says disconnected.
28. **Website quote form:** fill in the public quote or booking form for
    Velluma with a new name and your email. A new lead appears under
    Clients or Leads in the office, and you get the confirmation email.

## F. Tidy up

29. Delete or cancel the test booking series, void the test invoice, and
    archive the test client.

## What this does not cover (proven by the automated tests instead)

- Other companies' data staying private (tested at the database for every
  table and action).
- Sizes ten times Svit's.
- Stripe and Square payments and refunds (need real cards; tested against
  stand-ins).
- Payroll runs, bonuses, contracts, training, hiring, inventory (all
  covered by the automated suite; try any you care about by hand).
