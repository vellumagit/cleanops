import { describe, expect, it } from "vitest";
import { invoiceSearchOr, searchTokens, withOlder } from "./invoice-search";

describe("searchTokens", () => {
  it("keeps words of two letters or more, lower-cased, once each", () => {
    expect(searchTokens("Leslie  leslie July")).toEqual(["leslie", "july"]);
    expect(searchTokens("a 4 Jo")).toEqual(["jo"]);
    expect(searchTokens("   ")).toEqual([]);
  });

  it("takes out what would break or widen the filter", () => {
    expect(searchTokens('Smith, J. (INV-0042) *%"')).toEqual(["smith", "j.", "inv-0042"]);
  });

  it("sends at most five words", () => {
    expect(searchTokens("aa bb cc dd ee ff gg")).toHaveLength(5);
  });
});

describe("invoiceSearchOr", () => {
  it("matches the clients found by name or a number containing a word", () => {
    expect(invoiceSearchOr({ tokens: ["leslie", "0042"], clientIds: ["c1", "c2"] })).toBe(
      "client_id.in.(c1,c2),number.ilike.*leslie*,number.ilike.*0042*",
    );
  });

  it("with no client found, still looks at numbers", () => {
    expect(invoiceSearchOr({ tokens: ["inv-0007"], clientIds: [] })).toBe("number.ilike.*inv-0007*");
  });

  it("with nothing to look for, matches nothing rather than everything", () => {
    expect(invoiceSearchOr({ tokens: [], clientIds: [] })).toBe("id.eq.00000000-0000-0000-0000-000000000000");
  });
});

describe("withOlder", () => {
  it("adds only the rows not already loaded, after them", () => {
    const loaded = [{ id: "a" }, { id: "b" }];
    expect(withOlder(loaded, [{ id: "b" }, { id: "c" }])).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("returns the loaded rows themselves when nothing is new", () => {
    const loaded = [{ id: "a" }];
    expect(withOlder(loaded, [])).toBe(loaded);
    expect(withOlder(loaded, [{ id: "a" }])).toBe(loaded);
  });
});
