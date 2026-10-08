import { describe, it, expect } from "vitest";
import { chunkIds, selectInChunks } from "./chunked-in";

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

describe("selectInChunks", () => {
  it("splits 1,000 ids into requests that each stay small", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => uuid(i));
    const sizes: number[] = [];
    const { data, error } = await selectInChunks(ids, async (chunk) => {
      sizes.push(chunk.join(",").length);
      return { data: chunk.map((id) => ({ id })), error: null };
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
    expect(Math.max(...sizes)).toBeLessThan(8000);
  });

  it("dedupes and skips empty ids, and makes no request for none", async () => {
    let calls = 0;
    const run = async (chunk: string[]) => {
      calls++;
      return { data: chunk, error: null };
    };
    expect((await selectInChunks(["a", "a", "", "b"], run)).data).toEqual(["a", "b"]);
    expect((await selectInChunks([], run)).data).toEqual([]);
    expect(calls).toBe(1);
  });

  it("returns the rows it got plus the first error", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => uuid(i));
    const { data, error } = await selectInChunks(ids, async (chunk) =>
      chunk[0] === uuid(150)
        ? { data: null, error: { message: "Bad Request" } }
        : { data: chunk, error: null },
    );
    expect(error?.message).toBe("Bad Request");
    expect(data).toHaveLength(150);
  });

  it("chunkIds keeps order", () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
