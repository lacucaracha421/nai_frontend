import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveImageBytes } from "./client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("saved"), convertFileSrc: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Android save transport", () => {
  it.each(["png", "webp"])("sends %s bytes as JSON base64 and an unchanged Unicode filename", async (extension) => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    // Large subarray exercises chunk boundaries, high bytes and view offsets.
    const allocation = Uint8Array.from({ length: 150_000 }, (_, i) => i % 256);
    const bytes = allocation.subarray(13, allocation.length - 5);
    const filename = `NovelAI_한글_finish.${extension}`;
    await expect(saveImageBytes(bytes, filename)).resolves.toBe("saved");
    const [command, args] = vi.mocked(invoke).mock.calls[0];
    expect(command).toBe("save_image");
    const payload = JSON.parse(JSON.stringify(args));
    expect(payload.filename).toBe(filename);
    expect(payload.imageBase64).not.toContain("data:");
    expect(Uint8Array.from(atob(payload.imageBase64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});
