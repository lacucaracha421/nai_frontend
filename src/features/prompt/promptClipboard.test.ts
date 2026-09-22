import { describe, expect, it, vi } from "vitest";
import { copyWholePrompt } from "./promptClipboard";

describe("prompt clipboard", () => {
  it("copies the entire prompt exactly once without rewriting it", async () => {
    const write = vi.fn(async (_value: string) => undefined);
    const value = "  artist:toma, toon (style),  soft light\nartist:other, ";

    await copyWholePrompt(value, write);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(value);
  });

  it("does not write an empty prompt", async () => {
    const write = vi.fn();
    await copyWholePrompt("", write);
    expect(write).not.toHaveBeenCalled();
  });

  it("propagates clipboard failure for the editor to show", async () => {
    await expect(copyWholePrompt("artist:test", async () => { throw new Error("denied"); }))
      .rejects.toThrow("denied");
  });
});
