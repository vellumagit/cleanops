import { describe, it, expect } from "vitest";
import {
  jobAddress,
  propertyLabel,
  checklistTemplateFor,
  propertyDisplay,
  isMultiProperty,
} from "./client-properties";

describe("where the cleaner goes", () => {
  it("uses the property's address when the booking has no snapshot", () => {
    expect(
      jobAddress({
        bookingAddress: null,
        property: { address: "155 Whyte Ave" },
        clientAddress: "1 Client St",
      }),
    ).toBe("155 Whyte Ave");
  });

  it("keeps the booking's own snapshot even when the property disagrees", () => {
    // The job happened at the snapshot and was invoiced from it. Correcting a
    // property's address later must not restate finished work.
    expect(
      jobAddress({
        bookingAddress: "10815 Jasper Ave",
        property: { address: "155 Whyte Ave" },
        clientAddress: "1 Client St",
      }),
    ).toBe("10815 Jasper Ave");
  });

  it("falls back to the client for every single-address client in the app", () => {
    expect(
      jobAddress({ bookingAddress: null, clientAddress: "1 Client St" }),
    ).toBe("1 Client St");
  });

  it("treats whitespace as absent rather than as an address", () => {
    // A cleaner sent to "   " has been sent nowhere, and the fallbacks exist
    // precisely so that never happens.
    expect(
      jobAddress({
        bookingAddress: "   ",
        property: { address: "" },
        clientAddress: "1 Client St",
      }),
    ).toBe("1 Client St");
  });

  it("returns null when nothing anywhere has an address", () => {
    expect(jobAddress({})).toBeNull();
  });
});

describe("naming a property", () => {
  it("returns null rather than inventing a label", () => {
    // Every ordinary client would otherwise render a meaningless "Main
    // address" chip, which trains people to stop reading the field.
    expect(propertyLabel(null)).toBeNull();
    expect(propertyLabel({ label: "  " })).toBeNull();
  });

  it("renders label and address together for a picker", () => {
    expect(propertyDisplay({ label: "Unit 3", address: "155 Whyte Ave" })).toBe(
      "Unit 3 — 155 Whyte Ave",
    );
  });

  it("still renders when only one half exists", () => {
    expect(propertyDisplay({ label: "Unit 3" })).toBe("Unit 3");
    expect(propertyDisplay({ address: "155 Whyte Ave" })).toBe("155 Whyte Ave");
    expect(propertyDisplay(null)).toBe("Untitled property");
  });
});

describe("which checklist applies", () => {
  it("lets the property override the client", () => {
    // A studio turnover and a four-bedroom share a payer, not a clean.
    expect(
      checklistTemplateFor({
        property: { default_checklist_template_id: "prop-tpl" },
        clientDefaultTemplateId: "client-tpl",
      }),
    ).toBe("prop-tpl");
  });

  it("falls back to the client's default so nothing changes for existing clients", () => {
    expect(
      checklistTemplateFor({
        property: { default_checklist_template_id: null },
        clientDefaultTemplateId: "client-tpl",
      }),
    ).toBe("client-tpl");
    expect(checklistTemplateFor({ clientDefaultTemplateId: "client-tpl" })).toBe(
      "client-tpl",
    );
  });

  it("is null when neither level sets one", () => {
    expect(checklistTemplateFor({})).toBeNull();
  });
});

describe("hiding the feature from clients who don't need it", () => {
  it("one property is not multi-property", () => {
    // The backfill gives every existing client exactly one, so the UI stays
    // invisible until somebody deliberately adds a second.
    expect(isMultiProperty([{ id: "a" }])).toBe(false);
    expect(isMultiProperty([])).toBe(false);
    expect(isMultiProperty(null)).toBe(false);
  });

  it("two or more is", () => {
    expect(isMultiProperty([{ id: "a" }, { id: "b" }])).toBe(true);
  });
});
