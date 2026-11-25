import { describe, expect, it } from "vitest";
import { bookingSearchOr, containsPattern, textTerm } from "./booking-search";

describe("searching bookings on the server", () => {
  it("matches the client, the cleaner, the service and the address", () => {
    expect(bookingSearchOr({ needle: "Brian", clientIds: ["c1", "c2"], memberIds: ["m1"] })).toBe(
      "client_id.in.(c1,c2),assigned_to.in.(m1),service_type_label.ilike.*Brian*,address.ilike.*Brian*",
    );
  });

  it("takes out what would break the filter or widen it", () => {
    expect(textTerm('Smith, J. (old) "x" 100%*')).toBe("Smith J. old x 100");
    expect(bookingSearchOr({ needle: "a,b)", clientIds: [], memberIds: [] })).toBe(
      "service_type_label.ilike.*a b*,address.ilike.*a b*",
    );
  });

  it("a search of only syntax characters, with no names matching, finds nothing rather than everything", () => {
    expect(bookingSearchOr({ needle: ",()*", clientIds: [], memberIds: [] })).toBe(
      "id.eq.00000000-0000-0000-0000-000000000000",
    );
  });

  it("escapes LIKE's own wildcards in a name lookup", () => {
    expect(containsPattern(" 100%_off\\ ")).toBe("%100\\%\\_off\\\\%");
  });
});
