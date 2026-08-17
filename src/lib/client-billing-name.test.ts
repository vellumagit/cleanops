import { describe, expect, it } from "vitest";
import {
  billsAsCompany,
  clientBillingAttn,
  clientBillingLine,
  clientBillingName,
} from "@/lib/client-billing-name";

const person = { name: "Dana Reid", company_name: null };
const business = { name: "Dana Reid", company_name: "Riverbend Consulting Ltd." };

describe("a client billed as themselves — the common case", () => {
  it("bills under their own name", () => {
    expect(clientBillingName(person)).toBe("Dana Reid");
  });

  it("has no Attn line — 'Attn: themselves' is noise", () => {
    expect(clientBillingAttn(person)).toBeNull();
  });

  it("renders as one plain name", () => {
    expect(clientBillingLine(person)).toBe("Dana Reid");
  });

  it("is not a company", () => {
    expect(billsAsCompany(person)).toBe(false);
  });
});

describe("a client who runs a business from home", () => {
  it("bills the company, so the bookkeeper can file it", () => {
    expect(clientBillingName(business)).toBe("Riverbend Consulting Ltd.");
  });

  it("keeps the person as the contact", () => {
    expect(clientBillingAttn(business)).toBe("Dana Reid");
  });

  it("collapses to one line where there is only room for one", () => {
    expect(clientBillingLine(business)).toBe(
      "Riverbend Consulting Ltd. (Dana Reid)",
    );
  });
});

describe("half-filled data behaves like no company at all", () => {
  it("treats blank and whitespace-only as unset", () => {
    for (const company_name of ["", "   ", null, undefined]) {
      const c = { name: "Dana Reid", company_name };
      expect(clientBillingName(c)).toBe("Dana Reid");
      expect(clientBillingAttn(c)).toBeNull();
      expect(billsAsCompany(c)).toBe(false);
    }
  });

  it("trims a padded company name rather than printing the padding", () => {
    const c = { name: "Dana Reid", company_name: "  Riverbend Ltd.  " };
    expect(clientBillingName(c)).toBe("Riverbend Ltd.");
  });

  it("a company with no contact name bills the company and skips Attn", () => {
    const c = { name: "", company_name: "Riverbend Ltd." };
    expect(clientBillingName(c)).toBe("Riverbend Ltd.");
    expect(clientBillingAttn(c)).toBeNull();
    expect(clientBillingLine(c)).toBe("Riverbend Ltd.");
  });

  it("never renders an empty billing name onto a document", () => {
    expect(clientBillingName(null)).toBe("Client");
    expect(clientBillingName({ name: null, company_name: null })).toBe("Client");
  });
});
