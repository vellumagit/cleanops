import type { HelpArticle } from "./types";

export const article: HelpArticle = {
  slug: "team-comms",
  title: "Announcements, feed & chat",
  blurb: "Announcing something to the whole team, the optional team feed, and chat: direct messages, #general and photos.",
  section: "Your team",
  paths: ["/app/announce", "/app/feed", "/app/chat"],
  keywords: ["message", "messaging", "announcement", "broadcast", "group chat", "DM", "direct message", "team message", "general", "news", "bulletin", "post", "photo"],
  body: `
Sollos has three ways to talk to your team, all under **Comms** in the sidebar:

- **Announce**: one message to everyone at once, in chat, in their notifications, and by email if you choose.
- **Feed**: an optional board of team updates that managers post and everyone reads.
- **Chat**: direct messages between two people, plus **#general** for the whole team.

Texts from clients to your company number are a separate inbox, covered in [Texting](help:texting).

## Announcing something to everyone

Use **Announce** when everyone needs to know something: a schedule change, a holiday closure, a new rule. Owners, admins and managers can send announcements.

1. Go to **Announce**.
2. Write a **Subject** and a **Message**.
3. Decide whether to tick **Also email it to everyone**.
4. Click **Announce**. The button reads **Announce and email** when the box is ticked.

Every announcement does two things:

- **It's posted in #general** as a chat message, so there's a place to scroll back to and reply. Everyone in #general who has push notifications turned on gets one.
- **It's saved to everyone's notifications**, so it doesn't scroll away.

Email is off by default, so the team doesn't get mailed about every shift swap. Under the checkbox, Sollos shows how many devices have push turned on, and with the box ticked, how many active team members the email will reach. Push only reaches phones where someone turned notifications on, so for anything people must actually see, tick the email box.

## The team feed

The feed is a page of team updates: news, wins, reminders, with an optional photo. It's **off** until you turn it on. While it's off, the Feed link is hidden in both the office and the field app, and the page won't open.

**To turn it on or off:** go to [Settings → Team alerts & housekeeping](/app/settings/team-alerts) and switch **Show team feed**. See [Automations](help:automations) for that page.

With the feed on:

- **Owners, admins and managers can post.** Type in the box, optionally add one photo (JPG, PNG, GIF or WebP, up to 5 MB), and click **Post**.
- **Everyone can read it**, in the office and in the field app's **Feed** tab.
- Each post has a menu with **Pin to top** and **Delete**. Pinning and unpinning work for the person who posted it, an owner or an admin. Deleting a post also removes its photo.

Posting to the feed doesn't send a notification. To make sure everyone sees something, use **Announce** instead.

## Chat

Everyone on the team can use **Chat**, in the office or in the field app's **Chat** tab. The list on the left shows your conversations, with a count of unread messages on each.

**#general** includes everyone. New team members are added to it automatically when they join, so it's the place for anything the whole team should see.

**Direct messages:**

1. Click **New DM** at the top of the conversation list.
2. Pick a teammate and click **Open DM**. If you already have a conversation with them, it opens that one.

You can only message people who have a login. Anyone added manually under Employees, or who hasn't accepted their invite yet, is listed as not having joined the app, with a reminder to invite them from Employees.

**Photos:** tap the camera to take one, or the gallery icon to pick a few. You can send up to 6 photos in one message, each up to 20 MB. Add some words if you like, or send the photos on their own. Only photos can be sent; other kinds of file are refused.

When someone sends a message, everyone else in that conversation who has push notifications turned on gets one. Office staff are taken to the office chat, and cleaners to the field app. People who have been deactivated stay in #general's history but stop getting notifications. How to turn notifications on for a phone is in [Getting around Sollos](help:getting-around).

## Common questions

**My announcement went out, but half the team says they never saw it.** Push only reaches phones where notifications were turned on. The Announce page shows how many devices have it. For anything important, tick **Also email it to everyone**.

**Where is the Feed? I can't find it in the menu.** The feed is off by default. Turn it on with **Show team feed** in **Settings → Team alerts & housekeeping**, and the Feed link appears in the office and the field app.

**Can cleaners post to the feed?** No. Only owners, admins and managers can post. Everyone can read it, and anyone can talk back in **Chat**.

**Why can't I DM one of my cleaners?** They don't have a login yet: either they were added manually, or they haven't accepted their invite. Invite them from Employees using the email on their record, and once they've joined you can message them.

**Can I send a PDF or a document in chat?** No, only photos, up to 6 per message.

**Why was my message refused for containing a card number?** Chat, feed posts and announcements are kept and readable by the whole team, so Sollos refuses anything that looks like a credit card number. Remove the number and send again.

**Who can see #general?** Everyone on your team. Direct messages are only visible to the two people in them.
`,
};
