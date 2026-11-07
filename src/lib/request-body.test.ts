import { describe, expect, it } from "vitest";
import { readRequestBody } from "./request-body";

describe("readRequestBody", () => {
  it("reads JSON submissions", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ari" }),
    });

    await expect(readRequestBody(request)).resolves.toEqual({ name: "Ari" });
  });

  it("reads urlencoded submissions", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Ari&city=Calgary",
    });

    await expect(readRequestBody(request)).resolves.toEqual({
      name: "Ari",
      city: "Calgary",
    });
  });

  it("reads multipart text fields and ignores uploaded files", async () => {
    const formData = new FormData();
    formData.set("name", "Ari");
    formData.set("attachment", new Blob(["contents"]), "file.txt");
    const request = new Request("https://example.test", {
      method: "POST",
      body: formData,
    });

    await expect(readRequestBody(request)).resolves.toEqual({
      name: "Ari",
      attachment: "",
    });
  });
});
