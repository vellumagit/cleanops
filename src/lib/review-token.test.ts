import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  legacyStoredForms,
  legacyTokenMatches,
  parseReviewLinkToken,
  reviewLinkToken,
  reviewTokenIsFor,
  storedReviewToken,
} from "./review-token";

const JOB = "3f2a9c10-7b1e-4c55-9d2a-0a1b2c3d4e5f";
const OTHER = "9d8c7b6a-5f4e-4d3c-8b2a-1a0b9c8d7e6f";

let savedKey: string | undefined;
let savedSecret: string | undefined;
beforeEach(() => {
  savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  savedSecret = process.env.REVIEW_LINK_SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  delete process.env.REVIEW_LINK_SECRET;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  if (savedSecret === undefined) delete process.env.REVIEW_LINK_SECRET;
  else process.env.REVIEW_LINK_SECRET = savedSecret;
});

describe("a signed review link", () => {
  it("names its job and is the same link every time it is asked for", () => {
    const token = reviewLinkToken("booking", JOB);
    expect(token).toBe(reviewLinkToken("booking", JOB));
    expect(parseReviewLinkToken(token)).toEqual({ source: "booking", id: JOB });
    expect(parseReviewLinkToken(reviewLinkToken("invoice", JOB))).toEqual({ source: "invoice", id: JOB });
  });

  it("cannot be moved to another job, another kind, or edited", () => {
    const token = reviewLinkToken("booking", JOB);
    const [v, kind, id, sig] = token.split(".");
    expect(parseReviewLinkToken([v, kind, OTHER, sig].join("."))).toBeNull();
    expect(parseReviewLinkToken([v, "i", id, sig].join("."))).toBeNull();
    expect(parseReviewLinkToken([v, kind, id, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A")].join("."))).toBeNull();
    expect(parseReviewLinkToken([v, kind, id, ""].join("."))).toBeNull();
    expect(parseReviewLinkToken("not.a.token")).toBeNull();
    expect(parseReviewLinkToken("")).toBeNull();
  });

  it("depends on the server's key: a different key makes a different link", () => {
    const token = reviewLinkToken("booking", JOB);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "another-deployment";
    expect(reviewLinkToken("booking", JOB)).not.toBe(token);
    expect(parseReviewLinkToken(token)).toBeNull();
  });

  it("prefers REVIEW_LINK_SECRET when one is set", () => {
    const withServiceKey = reviewLinkToken("booking", JOB);
    process.env.REVIEW_LINK_SECRET = "dedicated-secret";
    expect(reviewLinkToken("booking", JOB)).not.toBe(withServiceKey);
  });

  it("refuses to work with no key at all", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => reviewLinkToken("booking", JOB)).toThrow(/REVIEW_LINK_SECRET or SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("a link emailed before signed links existed", () => {
  const emailed = "k3J9xQp2LmN8vR4t";

  it("still works once the column holds only its hash", () => {
    const stored = storedReviewToken(emailed);
    expect(stored).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(legacyTokenMatches(stored, emailed)).toBe(true);
    expect(legacyStoredForms(emailed)).toContain(stored);
  });

  it("still works on a row the migration has not reached", () => {
    expect(legacyTokenMatches(emailed, emailed)).toBe(true);
    expect(legacyStoredForms(emailed)).toContain(emailed);
  });

  /** The whole point: what a member can read is not what the page accepts. */
  it("the stored value is never accepted as the token", () => {
    const stored = storedReviewToken(emailed);
    expect(legacyTokenMatches(stored, stored)).toBe(false);
    expect(legacyStoredForms(stored)).toEqual([]);
    expect(reviewTokenIsFor(stored, "booking", JOB, stored)).toBe(false);
  });

  it("does not match another token, or a row with none", () => {
    expect(legacyTokenMatches(storedReviewToken(emailed), "something-else")).toBe(false);
    expect(legacyTokenMatches(null, emailed)).toBe(false);
    expect(legacyTokenMatches(storedReviewToken(emailed), "")).toBe(false);
  });
});

describe("reviewTokenIsFor", () => {
  it("accepts a signed link only for the job it names", () => {
    const token = reviewLinkToken("booking", JOB);
    expect(reviewTokenIsFor(token, "booking", JOB, null)).toBe(true);
    expect(reviewTokenIsFor(token, "booking", OTHER, null)).toBe(false);
    expect(reviewTokenIsFor(token, "invoice", JOB, null)).toBe(false);
  });

  it("accepts a signed link whatever the column holds", () => {
    const token = reviewLinkToken("invoice", JOB);
    expect(reviewTokenIsFor(token, "invoice", JOB, storedReviewToken("an older emailed token"))).toBe(true);
  });

  it("accepts a legacy link against its row and nothing else", () => {
    const stored = storedReviewToken("emailed-token");
    expect(reviewTokenIsFor("emailed-token", "booking", JOB, stored)).toBe(true);
    expect(reviewTokenIsFor("emailed-token", "booking", JOB, null)).toBe(false);
    expect(reviewTokenIsFor("guess", "booking", JOB, stored)).toBe(false);
  });
});
