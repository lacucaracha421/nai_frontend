import { describe, expect, it, vi } from "vitest";
import type { RgbaImage } from "../finish/finishFilter";
import { FINISH_PRESETS } from "../finish/finishFilter";
import { formatFileSize, prepareSave, withExtension, type SaveDeps } from "./prepareSave";
import { readWebpChunks } from "./webpContainer";
import { encodeVerifiedWebp, handleWebpSaveRequest, WEBP_QUALITY, type WebpCodec } from "./webpSave";

function stealthSource(width = 32, height = 8): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(180);
  for (let i = 3; i < data.length; i += 4) data[i] = 254;
  const bits = [...new TextEncoder().encode("stealth_pngcomp")].flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (byte >> s) & 1));
  bits.forEach((bit, index) => {
    const x = Math.floor(index / height);
    const y = index % height;
    data[(y * width + x) * 4 + 3] = 254 | bit;
  });
  return { data, width, height };
}

/** A fake lossy encoder: emits VP8X + ALPH + VP8 and "decodes" back to `decoded(source)`. */
function fakeCodec(decoded: (source: RgbaImage) => RgbaImage, options: { emit?: Uint8Array } = {}) {
  let last: RgbaImage | null = null;
  const codec: WebpCodec = {
    decodePng: vi.fn(async () => stealthSource()),
    encodeWebp: vi.fn(async (image: RgbaImage) => {
      last = image;
      if (options.emit) return options.emit;
      const vp8x = [0x10, 0, 0, 0, image.width - 1, 0, 0, image.height - 1, 0, 0];
      return new Uint8Array([
        ...new TextEncoder().encode("RIFF"), 42, 0, 0, 0, ...new TextEncoder().encode("WEBP"),
        ...new TextEncoder().encode("VP8X"), 10, 0, 0, 0, ...vp8x,
        ...new TextEncoder().encode("ALPH"), 2, 0, 0, 0, 1, 2,
        ...new TextEncoder().encode("VP8 "), 2, 0, 0, 0, 3, 4,
      ]);
    }),
    decodeWebp: vi.fn(async () => decoded(last!)),
  };
  return codec;
}

const XMP = "<x:xmpmeta/>";

describe("verified WebP encoding", () => {
  it("accepts an encode whose alpha survives and adds XMP (never EXIF)", async () => {
    const codec = fakeCodec((source) => {
      const rgbShifted = source.data.slice();
      for (let i = 0; i < rgbShifted.length; i += 4) rgbShifted[i] -= 1; // lossy RGB is fine
      return { ...source, data: rgbShifted };
    });
    const result = await encodeVerifiedWebp(stealthSource(), XMP, codec);
    expect(result.ok).toBe(true);
    expect(codec.encodeWebp).toHaveBeenCalledWith(expect.anything(), WEBP_QUALITY);
    const chunks = readWebpChunks(new Uint8Array(result.ok ? result.bytes : new ArrayBuffer(0)));
    expect(chunks.map((c) => c.fourcc)).toEqual(["VP8X", "ALPH", "VP8 ", "XMP "]);
    expect(chunks[0].payload[0]).toBe(0x14);
  });

  it("rejects an encode that changed alpha (e.g. premultiplication loss)", async () => {
    const codec = fakeCodec((source) => {
      const data = source.data.slice();
      data[3] = 255;
      return { ...source, data };
    });
    expect(await encodeVerifiedWebp(stealthSource(), XMP, codec)).toEqual({ ok: false, reason: "alpha changed" });
  });

  it("rejects an engine that returned PNG instead of WebP, and reports thrown errors", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const codec = fakeCodec((s) => s, { emit: png });
    expect(await encodeVerifiedWebp(stealthSource(), XMP, codec)).toMatchObject({ ok: false });
    const broken = fakeCodec((s) => s);
    broken.decodePng = async () => {
      throw new Error("decode failed");
    };
    expect(await handleWebpSaveRequest({ source: { kind: "png", bytes: new ArrayBuffer(8) }, xmp: XMP }, broken)).toEqual({
      ok: false,
      reason: "decode failed",
    });
  });
});

const ORIGINAL = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 13, ...new TextEncoder().encode("IHDR"), ...new Array(13).fill(0), 0, 0, 0, 0,
  0, 0, 0, 7, ...new TextEncoder().encode("tEXt"), ...new TextEncoder().encode("Title\0x"), 0, 0, 0, 0,
  0, 0, 0, 0, ...new TextEncoder().encode("IEND"), 0, 0, 0, 0,
]);

function deps(convert: SaveDeps["convertWebp"]): SaveDeps {
  return {
    renderFinished: vi.fn(async () => stealthSource()),
    encodePng: vi.fn(async () => new Uint8Array([1, 2, 3])),
    convertWebp: vi.fn(convert),
  };
}

describe("save preparation", () => {
  const input = { original: ORIGINAL, baseName: "NovelAI_20260924_seed1.png" };

  it("saves WebP with the NovelAI text fields as XMP", async () => {
    const d = deps(async () => ({ ok: true, bytes: new Uint8Array([9]).buffer }));
    const saved = await prepareSave({ ...input, format: "webp", finish: null }, d);
    expect(saved).toEqual({ bytes: new Uint8Array([9]), filename: "NovelAI_20260924_seed1.webp", format: "webp", fallback: false });
    const request = vi.mocked(d.convertWebp).mock.calls[0][0];
    expect(request.source.kind).toBe("png");
    expect(request.xmp).toContain("<nai:Title>x</nai:Title>");
    // The caller's original bytes are not detached by the transfer.
    expect(ORIGINAL.length).toBeGreaterThan(0);
  });

  it("keeps the _finish suffix and sends the filtered pixels", async () => {
    const d = deps(async () => ({ ok: true, bytes: new Uint8Array([9]).buffer }));
    const saved = await prepareSave({ ...input, format: "webp", finish: FINISH_PRESETS.anime }, d);
    expect(saved.filename).toBe("NovelAI_20260924_seed1_finish.webp");
    expect(vi.mocked(d.convertWebp).mock.calls[0][0].source.kind).toBe("rgba");
    expect(d.encodePng).not.toHaveBeenCalled();
  });

  it("falls back to PNG when WebP verification fails or the worker throws", async () => {
    const failed = deps(async () => ({ ok: false, reason: "alpha changed" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await prepareSave({ ...input, format: "webp", finish: null }, failed)).toEqual({
      bytes: ORIGINAL,
      filename: "NovelAI_20260924_seed1.png",
      format: "png",
      fallback: true,
    });
    const thrown = deps(async () => {
      throw new Error("no worker");
    });
    const finished = await prepareSave({ ...input, format: "webp", finish: FINISH_PRESETS.anime }, thrown);
    expect(finished).toEqual({ bytes: new Uint8Array([1, 2, 3]), filename: "NovelAI_20260924_seed1_finish.png", format: "png", fallback: true });
  });

  it("leaves the PNG path unchanged", async () => {
    const d = deps(async () => ({ ok: true, bytes: new ArrayBuffer(1) }));
    expect(await prepareSave({ ...input, format: "png", finish: null }, d)).toEqual({
      bytes: ORIGINAL,
      filename: "NovelAI_20260924_seed1.png",
      format: "png",
      fallback: false,
    });
    expect(d.convertWebp).not.toHaveBeenCalled();
  });

  it("formats names and sizes", () => {
    expect(withExtension("a_finish.png", "webp")).toBe("a_finish.webp");
    expect(withExtension("a.WEBP", "png")).toBe("a.png");
    expect(formatFileSize(135_168)).toBe("132 KB");
    expect(formatFileSize(1_132_479)).toBe("1.1 MB");
  });
});
