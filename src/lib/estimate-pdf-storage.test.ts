import { describe, expect, it } from "vitest";
import {
  estimatePdfLink,
  estimatePdfPath,
  estimatePdfPathFromRef,
  estimatePdfRef,
  storeEstimatePdf,
} from "./estimate-pdf-storage";

const ORG = "4b0d3b68-6d8e-4d54-a69f-fe6f3d02e447";
const EST = "9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

/** Just enough of the storage client to see what is asked of it. */
function fakeAdmin() {
  const calls: Array<{ bucket: string; op: string; arg: unknown }> = [];
  const admin = {
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string) => {
            calls.push({ bucket, op: "upload", arg: path });
            return { error: null };
          },
          createSignedUrl: async (path: string, seconds: number) => {
            calls.push({ bucket, op: "sign", arg: { path, seconds } });
            return { data: { signedUrl: `https://files.test/${bucket}/${path}?token=t&expires=${seconds}` }, error: null };
          },
          getPublicUrl: (path: string) => {
            calls.push({ bucket, op: "public", arg: path });
            return { data: { publicUrl: `https://files.test/public/${bucket}/${path}` } };
          },
        };
      },
    },
  };
  return { admin: admin as never, calls };
}

describe("estimate PDFs are private", () => {
  it("stores into the private bucket and saves a reference, not a link", async () => {
    const { admin, calls } = fakeAdmin();
    const { ref, error } = await storeEstimatePdf(admin, ORG, EST, new Uint8Array([37, 80, 68, 70]));
    expect(error).toBeNull();
    expect(ref).toBe(`storage:estimate-pdfs/${ORG}/estimates/${EST}.pdf`);
    expect(calls).toEqual([{ bucket: "estimate-pdfs", op: "upload", arg: `${ORG}/estimates/${EST}.pdf` }]);
    // Nothing ever asks for a public URL.
    expect(calls.some((c) => c.op === "public")).toBe(false);
  });

  it("hands a viewer a link that expires in an hour", async () => {
    const { admin, calls } = fakeAdmin();
    const link = await estimatePdfLink(admin, estimatePdfRef(`${ORG}/estimates/${EST}.pdf`));
    expect(link).toBe(`https://files.test/estimate-pdfs/${ORG}/estimates/${EST}.pdf?token=t&expires=3600`);
    expect(calls).toEqual([{ bucket: "estimate-pdfs", op: "sign", arg: { path: `${ORG}/estimates/${EST}.pdf`, seconds: 3600 } }]);
  });

  it("passes an old plain URL through, and nothing for nothing", async () => {
    const { admin, calls } = fakeAdmin();
    expect(await estimatePdfLink(admin, "https://old.example/x.pdf")).toBe("https://old.example/x.pdf");
    expect(await estimatePdfLink(admin, null)).toBeNull();
    expect(calls).toEqual([]);
    expect(estimatePdfPathFromRef("https://old.example/x.pdf")).toBeNull();
  });

  it("refuses ids that are not uuids, so a path can't be walked", () => {
    expect(() => estimatePdfPath(ORG, "../../other-org/logo")).toThrow();
    expect(() => estimatePdfPath("x", EST)).toThrow();
    expect(estimatePdfPath(ORG, EST)).toBe(`${ORG}/estimates/${EST}.pdf`);
  });
});
