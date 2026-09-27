import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
it("deduplicates requests, runs at most two, prioritizes visible tiles, and retries failures explicitly", async () => {
  const pending: { raw: string; resolve: (value: string | null) => void; reject: () => void }[] = [];
  vi.mocked(invoke).mockImplementation((_command, args) => new Promise((resolve, reject) => {
    pending.push({ raw: (args as { raw: string }).raw, resolve: resolve as (value: string | null) => void, reject: () => reject(new Error("offline")) });
  }));
  const { requestThumbnail, prefetchThumbnails } = await import("./characterThumbnails");
  prefetchThumbnails(["one", "two", "three", "four"]);
  requestThumbnail("one"); requestThumbnail("four", true);
  expect(pending.map(p => p.raw)).toEqual(["one", "two"]);
  pending[0].resolve("data:image/webp;base64,fixture");
  await vi.waitFor(() => expect(pending.map(p => p.raw)).toEqual(["one", "two", "four"]));
  pending[1].reject();
  await vi.waitFor(() => expect(pending.at(-1)?.raw).toBe("three"));
  pending[2].resolve(null); pending[3].resolve(null);
  await new Promise(resolve => setTimeout(resolve, 0));
  requestThumbnail("one"); requestThumbnail("two"); requestThumbnail("four");
  expect(pending).toHaveLength(4);
  requestThumbnail("two", true, true);
  expect(pending.at(-1)?.raw).toBe("two");
  pending.at(-1)!.resolve(null);
});
