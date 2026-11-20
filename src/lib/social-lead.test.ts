import { describe, expect, it } from "vitest";
import {
  parseSocialLead,
  socialLeadDetails,
  socialLeadTitle,
  sourceFromText,
} from "./social-lead";
import { sourceLabel } from "./lead-pipeline";

function lead(body: Record<string, unknown>) {
  const r = parseSocialLead(body);
  if (!r.ok) throw new Error(`expected a lead, got ${r.error}`);
  return r.lead;
}

describe("ManyChat's Full Contact Data", () => {
  // The shape ManyChat's External Request sends when the owner ticks
  // "Full Contact Data" — trimmed to the fields that matter.
  const manychat = {
    id: "1234567890",
    page_id: "987",
    status: "active",
    first_name: "Sarah",
    last_name: "Lee",
    name: "Sarah Lee",
    profile_pic: "https://example.com/p.jpg",
    last_input_text: "How much for a 3 bed deep clean?",
    optin_phone: false,
    phone: null,
    optin_email: false,
    email: null,
    ig_username: "sarah.cleans",
    ig_id: 556677,
    custom_fields: { city: "Calgary" },
    tags: [{ id: 1, name: "lead" }],
  };

  it("reads the person, their handle, the message and the city", () => {
    expect(lead(manychat)).toMatchObject({
      name: "Sarah Lee",
      email: null,
      phone: null,
      source: "instagram",
      handle: "@sarah.cleans",
      message: "How much for a 3 bed deep clean?",
      place: "Calgary",
      externalId: "1234567890",
    });
  });

  it("an Instagram user with no name on file is still a lead, under their handle", () => {
    expect(lead({ ...manychat, name: "", first_name: "", last_name: "" }).name).toBe("@sarah.cleans");
  });

  it("a WhatsApp contact is filed as WhatsApp with that number as the phone", () => {
    const l = lead({ id: "1", name: "Omar", whatsapp_phone: "+1 403 555 0199" });
    expect(l).toMatchObject({ source: "whatsapp", phone: "+1 403 555 0199" });
  });
});

describe("GoHighLevel's workflow webhook", () => {
  const ghl = {
    contact_id: "abcDEF123",
    first_name: "Priya",
    last_name: "Shah",
    full_name: "Priya Shah",
    email: "priya@example.com",
    phone: "+15875550142",
    tags: "facebook lead",
    city: "Edmonton",
    website: "https://priya-designs.example.com",
    contact_source: "Facebook Lead Form",
    location: { name: "Svit Cleaning", city: "Calgary" },
    customData: { message: "Move-out clean next Friday", channel: "facebook" },
  };

  it("reads the contact and the custom data the owner added", () => {
    expect(lead(ghl)).toMatchObject({
      name: "Priya Shah",
      email: "priya@example.com",
      phone: "+15875550142",
      source: "facebook",
      message: "Move-out clean next Friday",
      place: "Edmonton",
      externalId: "abcDEF123",
    });
  });

  it("a website on the contact is a website, not a bot", () => {
    // The contact form's spam trap would have thrown this lead away.
    expect(parseSocialLead(ghl).ok).toBe(true);
  });

  it("the agency's own location never stands in for the contact's city", () => {
    expect(lead({ ...ghl, city: undefined }).place).toBeNull();
  });

  it("a top-level field beats the same name inside customData", () => {
    expect(lead({ ...ghl, customData: { email: "other@example.com" } }).email).toBe("priya@example.com");
  });
});

describe("hand-built payloads", () => {
  it("first and last name join when there's no full name", () => {
    expect(lead({ first_name: "Ana", last_name: "Diaz" }).name).toBe("Ana Diaz");
  });

  it("an email alone is enough, and names the lead", () => {
    expect(lead({ email: "kim.w@example.com" })).toMatchObject({ name: "kim.w", email: "kim.w@example.com", source: "social" });
  });

  it("a malformed email is dropped, not stored", () => {
    expect(lead({ name: "Jo", email: "not an email" }).email).toBeNull();
  });

  it("nothing to call them by is refused", () => {
    expect(parseSocialLead({ message: "hi" })).toEqual({ ok: false, error: "name_required" });
    expect(parseSocialLead({ name: "   ", tags: ["x"] })).toEqual({ ok: false, error: "name_required" });
  });

  it("a body that isn't an object is refused, not a crash", () => {
    for (const body of [null, "Sarah", 42, [{ name: "Sarah" }]]) {
      expect(parseSocialLead(body)).toEqual({ ok: false, error: "name_required" });
    }
  });

  it("objects and arrays are never read as a name", () => {
    expect(parseSocialLead({ name: { first: "x" } }).ok).toBe(false);
  });

  it("field names are case-insensitive", () => {
    expect(lead({ Name: "Lee", EMAIL: "lee@example.com" })).toMatchObject({ name: "Lee", email: "lee@example.com" });
  });

  it("caps what it keeps", () => {
    expect(lead({ name: "x".repeat(500), message: "y".repeat(5000) })).toMatchObject({
      name: "x".repeat(200),
      message: "y".repeat(2000),
    });
  });
});

describe("which network", () => {
  it.each([
    ["Instagram", "instagram"],
    ["IG DM", "instagram"],
    ["ig_story_reply", "instagram"],
    ["facebook_ads", "facebook"],
    ["Messenger", "facebook"],
    ["FB Lead Form", "facebook"],
    ["Meta lead ad", "facebook"],
    ["TikTok", "tiktok"],
    ["WhatsApp", "whatsapp"],
  ])("%s → %s", (text, want) => {
    expect(sourceFromText(text)).toBe(want);
  });

  it.each(["Google", "website", "metadata", "big", "manychat", ""])("%s names no network", (text) => {
    expect(sourceFromText(text)).toBeNull();
  });

  it("what the tool says beats what the payload looks like", () => {
    expect(lead({ name: "A", ig_username: "a", channel: "facebook" }).source).toBe("facebook");
  });

  it("says nothing and looks like nothing → Social / chat", () => {
    const l = lead({ name: "A", source: "manychat" });
    expect(l.source).toBe("social");
    expect(sourceLabel(l.source)).toBe("Social / chat");
  });
});

describe("what lands on the note", () => {
  it("titles and details", () => {
    const l = lead({ name: "Sarah", ig_username: "@sarah", message: "Hi", city: "Calgary", id: "42", via: "ManyChat" });
    expect(socialLeadTitle(l.source)).toBe("Instagram lead");
    expect(socialLeadDetails(l)).toEqual([
      "Message: Hi",
      "Handle: @sarah",
      "Location: Calgary",
      "Via: ManyChat",
      "Chat tool contact id: 42",
    ]);
    expect(socialLeadTitle("social")).toBe("Social / chat lead");
  });
});
