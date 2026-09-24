import { describe, expect, it } from "vitest";
import { copyPngMetadata, extractMetadataChunks, readPngChunks } from "./pngMetadata";
import { finishFilename } from "./finishFilter";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array | string) {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}
function png(...chunks: Uint8Array[]) {
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
const ihdr = chunk("IHDR", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
const idat = chunk("IDAT", new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
const iend = chunk("IEND", "");

describe("PNG metadata copy", () => {
  it("copies NovelAI text chunks into the processed PNG right after IHDR", () => {
    const description = chunk("tEXt", "Description\u00001girl, solo");
    const comment = chunk("tEXt", 'Comment\u0000{"seed":1234,"steps":28}');
    const itxt = chunk("iTXt", "Source\u0000\u0000\u0000\u0000\u0000NovelAI Diffusion V5");
    const original = png(ihdr, description, comment, itxt, idat, iend);
    const processed = png(ihdr, chunk("sRGB", new Uint8Array([0])), idat, iend);

    const merged = copyPngMetadata(original, processed);
    expect(readPngChunks(merged).map((c) => c.type)).toEqual(["IHDR", "tEXt", "tEXt", "iTXt", "sRGB", "IDAT", "IEND"]);
    expect(extractMetadataChunks(merged)).toEqual([description, comment, itxt]);
    // Image data of the processed PNG is kept byte-for-byte.
    expect(merged.subarray(merged.length - idat.length - iend.length)).toEqual(png(idat, iend).subarray(8));
  });

  it("replaces stale text chunks in the processed PNG and rejects non-PNG input", () => {
    const original = png(ihdr, chunk("tEXt", "Title\u0000new"), idat, iend);
    const processed = png(ihdr, chunk("tEXt", "Software\u0000canvas"), idat, iend);
    expect(extractMetadataChunks(copyPngMetadata(original, processed))).toEqual([chunk("tEXt", "Title\u0000new")]);
    expect(() => copyPngMetadata(new Uint8Array([1, 2, 3]), processed)).toThrow();
  });

  it("adds a _finish suffix to the save name", () => {
    expect(finishFilename("NovelAI_20260924_seed1.png")).toBe("NovelAI_20260924_seed1_finish.png");
  });
});
