import { describe, it, expect } from "vitest";
import { parsePostalAddress } from "./postal-address";

// Every string below is a real clients.address value from production.
describe("parsePostalAddress — real production shapes", () => {
  it("Google Places Canadian form, country before postal", () => {
    expect(
      parsePostalAddress("11260 153 Avenue Northwest, Edmonton, AB, Canada, T5X 6E7"),
    ).toEqual({
      address_line_1: "11260 153 Avenue Northwest",
      city: "Edmonton",
      region: "AB",
      postal_code: "T5X 6E7",
      country_id: "CA",
    });
  });

  it("region and postal sharing one comma-part", () => {
    expect(
      parsePostalAddress("123 Queen Street West, Toronto, ON M5H 2M9, Canada"),
    ).toEqual({
      address_line_1: "123 Queen Street West",
      city: "Toronto",
      region: "ON",
      postal_code: "M5H 2M9",
      country_id: "CA",
    });
  });

  it("US address", () => {
    expect(parsePostalAddress("350 5th Ave, New York, NY 10118, USA")).toEqual({
      address_line_1: "350 5th Ave",
      city: "New York",
      region: "NY",
      postal_code: "10118",
      country_id: "US",
    });
  });

  it("missing space after the comma", () => {
    expect(
      parsePostalAddress("14724 97a St NW,Edmonton, AB T5E 4H2"),
    ).toEqual({
      address_line_1: "14724 97a St NW",
      city: "Edmonton",
      region: "AB",
      postal_code: "T5E 4H2",
      country_id: "CA",
    });
  });

  it("street only — still a postable address, not a failure", () => {
    expect(parsePostalAddress("16505 133 Street NW")).toEqual({
      address_line_1: "16505 133 Street NW",
    });
    expect(parsePostalAddress("13 Fulton Place")).toEqual({
      address_line_1: "13 Fulton Place",
    });
  });
});

describe("parsePostalAddress — edge cases", () => {
  it("keeps a unit line between street and city", () => {
    expect(
      parsePostalAddress("500 Jasper Ave, Unit 12, Edmonton, AB, T5J 0N3"),
    ).toEqual({
      address_line_1: "500 Jasper Ave",
      address_line_2: "Unit 12",
      city: "Edmonton",
      region: "AB",
      postal_code: "T5J 0N3",
      country_id: "CA",
    });
  });

  it("infers the country from the postal code alone", () => {
    expect(parsePostalAddress("1 Main St, Calgary, AB T2P 1J9")?.country_id).toBe(
      "CA",
    );
    expect(parsePostalAddress("1 Main St, Austin, TX 78701")?.country_id).toBe(
      "US",
    );
  });

  it("applies the fallback country only when none is derivable", () => {
    expect(parsePostalAddress("16505 133 Street NW", "CA")?.country_id).toBe("CA");
    // An explicit country in the string always wins over the fallback.
    expect(
      parsePostalAddress("350 5th Ave, New York, NY 10118, USA", "CA")
        ?.country_id,
    ).toBe("US");
  });

  it("normalises postal case", () => {
    expect(parsePostalAddress("1 Main St, Calgary, ab t2p 1j9")).toEqual({
      address_line_1: "1 Main St",
      city: "Calgary",
      region: "AB",
      postal_code: "T2P 1J9",
      country_id: "CA",
    });
  });

  it("returns null when there is nothing usable", () => {
    // Callers must treat null as "cannot sync" — posting an empty address
    // object is what produced Sage contacts with `"main_address": {}`.
    expect(parsePostalAddress(null)).toBeNull();
    expect(parsePostalAddress("")).toBeNull();
    expect(parsePostalAddress("   ")).toBeNull();
    expect(parsePostalAddress("Canada")).toBeNull();
    expect(parsePostalAddress(", ,  ,")).toBeNull();
  });
});
