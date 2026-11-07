import { describe, expect, it } from "vitest";
import { readServiceExtras } from "./service-extras";

describe("readServiceExtras", () => {
  it("trims values and converts empty fields to null", () => {
    const formData = new FormData();
    formData.set("service_type_id", " service-1 ");
    formData.set("service_type_label", "  ");

    expect(readServiceExtras(formData)).toEqual({
      service_type_id: "service-1",
      service_type_label: null,
    });
  });
});
