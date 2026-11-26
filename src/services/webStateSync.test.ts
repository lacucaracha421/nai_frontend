import { describe, expect, it } from "vitest";
import { isAppStorageKey, SYNC_URL_STORAGE_KEY } from "./webStateSync";

describe("webStateSync key filtering", () => {
  it("syncs app state and quickcopy keys while keeping sync server URL device-local", () => {
    expect(isAppStorageKey("nai-v5-character-library-v1")).toBe(true);
    expect(isAppStorageKey("nai-v5-s11-generation-v0.3")).toBe(true);
    expect(isAppStorageKey("artist-tag-quick-copy.v4")).toBe(true);
    expect(isAppStorageKey(SYNC_URL_STORAGE_KEY)).toBe(false);
    expect(isAppStorageKey("unrelated-key")).toBe(false);
  });
});
