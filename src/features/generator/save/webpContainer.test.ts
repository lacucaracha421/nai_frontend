import { describe, expect, it } from "vitest";
import { hasWebpChunk, injectWebpXmp, readWebpChunks } from "./webpContainer";

const enc = (text: string) => new TextEncoder().encode(text);

/** Independent RIFF builder so the writer is not checked against itself. */
function riff(...chunks: [string, Uint8Array][]) {
  const parts: number[] = [];
  for (const [fourcc, payload] of chunks) {
    parts.push(...enc(fourcc), payload.length & 0xff, (payload.length >> 8) & 0xff, (payload.length >> 16) & 0xff, payload.length >>> 24);
    parts.push(...payload);
    if (payload.length & 1) parts.push(0);
  }
  const size = parts.length + 4;
  return new Uint8Array([...enc("RIFF"), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24, ...enc("WEBP"), ...parts]);
}

function vp8lHeader(width: number, height: number, alpha: boolean) {
  const bits = (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28);
  return new Uint8Array([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, bits >>> 24, 0xaa]);
}

/** Structural check: RIFF size, per-chunk sizes/padding, and chunk order. */
function inspect(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(bytes.length % 2).toBe(0);
  const chunks = readWebpChunks(bytes);
  // Walking the chunks must land exactly on the end of the file.
  const walked = 12 + chunks.reduce((n, c) => n + 8 + c.payload.length + (c.payload.length & 1), 0);
  expect(walked).toBe(bytes.length);
  const vp8x = chunks[0];
  expect(vp8x.fourcc).toBe("VP8X");
  const pv = vp8x.payload;
  return {
    order: chunks.map((c) => c.fourcc),
    flags: pv[0],
    width: 1 + (pv[4] | (pv[5] << 8) | (pv[6] << 16)),
    height: 1 + (pv[7] | (pv[8] << 8) | (pv[9] << 16)),
    xmp: new TextDecoder().decode(chunks.find((c) => c.fourcc === "XMP ")!.payload),
  };
}

const XMP_FLAG = 0x04;
const ALPHA_FLAG = 0x10;
const EXIF_FLAG = 0x08;

describe("WebP XMP injection", () => {
  it("wraps a simple lossy VP8 file in VP8X and puts ALPH before VP8", () => {
    // Odd-sized payloads exercise padding.
    const source = riff(["VP8 ", new Uint8Array([1, 2, 3])], ["ALPH", new Uint8Array([9, 9, 9, 9, 9])]);
    const out = injectWebpXmp(source, "<x>odd</x>", 832, 1216);
    const info = inspect(out);
    expect(info.order).toEqual(["VP8X", "ALPH", "VP8 ", "XMP "]);
    expect(info.flags).toBe(ALPHA_FLAG | XMP_FLAG);
    expect([info.width, info.height]).toEqual([832, 1216]);
    expect(info.xmp).toBe("<x>odd</x>");
  });

  it("does not set the alpha flag for an opaque VP8 file", () => {
    const out = injectWebpXmp(riff(["VP8 ", new Uint8Array([1, 2])]), "<x/>", 10, 20);
    const info = inspect(out);
    expect(info.order).toEqual(["VP8X", "VP8 ", "XMP "]);
    expect(info.flags).toBe(XMP_FLAG);
  });

  it("reads the alpha bit from a VP8L header", () => {
    const withAlpha = inspect(injectWebpXmp(riff(["VP8L", vp8lHeader(64, 32, true)]), "<a/>", 64, 32));
    expect(withAlpha.order).toEqual(["VP8X", "VP8L", "XMP "]);
    expect(withAlpha.flags).toBe(ALPHA_FLAG | XMP_FLAG);
    const opaque = inspect(injectWebpXmp(riff(["VP8L", vp8lHeader(64, 32, false)]), "<a/>", 64, 32));
    expect(opaque.flags).toBe(XMP_FLAG);
  });

  it("keeps an existing VP8X header, replaces XMP, and drops EXIF", () => {
    const vp8x = new Uint8Array([ALPHA_FLAG | EXIF_FLAG | XMP_FLAG, 0, 0, 0, 99, 0, 0, 49, 0, 0]);
    const source = riff(
      ["VP8X", vp8x],
      ["ICCP", new Uint8Array([7])],
      ["ALPH", new Uint8Array([5, 5])],
      ["VP8 ", new Uint8Array([1, 2, 3, 4])],
      ["EXIF", enc("Exif\0\0junk")],
      ["XMP ", enc("<old/>")],
    );
    const out = injectWebpXmp(source, "<new/>", 1, 1);
    const info = inspect(out);
    expect(info.order).toEqual(["VP8X", "ICCP", "ALPH", "VP8 ", "XMP "]);
    expect(info.flags).toBe(ALPHA_FLAG | XMP_FLAG);
    // Canvas size comes from the existing header, not the arguments.
    expect([info.width, info.height]).toEqual([100, 50]);
    expect(info.xmp).toBe("<new/>");
    expect(hasWebpChunk(out, "EXIF")).toBe(false);
  });

  it("round-trips UTF-8 XMP and rejects broken input", () => {
    const xmp = '<?xpacket begin="﻿"?><nai:Description>한글 · 1girl</nai:Description>';
    expect(inspect(injectWebpXmp(riff(["VP8 ", new Uint8Array([1])]), xmp, 2, 2)).xmp).toBe(xmp);
    expect(() => injectWebpXmp(enc("RIFF\0\0\0\0WAVE"), "<x/>", 1, 1)).toThrow();
    expect(() => injectWebpXmp(riff(["ICCP", new Uint8Array([1])]), "<x/>", 1, 1)).toThrow();
    const truncated = riff(["VP8 ", new Uint8Array([1, 2, 3, 4])]).slice(0, 22);
    new DataView(truncated.buffer).setUint32(4, 100, true);
    expect(() => readWebpChunks(truncated)).toThrow();
  });
});
