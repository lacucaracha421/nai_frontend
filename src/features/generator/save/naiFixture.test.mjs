// Checks the metadata helpers against the user's real NovelAI PNG when it exists on this machine.
// The file is read in place and never copied into the repository.
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readPngChunks } from "../finish/pngMetadata";
import { readStealthMagic } from "./stealth";
import { buildXmpPacket, pngTextFields } from "./xmpMetadata";

const FIXTURE = "/home/laku/바탕화면/NovelAI_20260920_183313_seed2181637352.png";

/** Minimal 8-bit RGBA, non-interlaced PNG decoder (test only). */
function decodeRgba(png) {
  const chunks = readPngChunks(png);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdr = chunks[0].start + 8;
  const width = view.getUint32(ihdr);
  const height = view.getUint32(ihdr + 4);
  if (png[ihdr + 8] !== 8 || png[ihdr + 9] !== 6 || png[ihdr + 12] !== 0) throw new Error("fixture is not 8-bit RGBA");
  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => png.subarray(c.start + 8, c.end - 4)));
  const raw = inflateSync(idat);
  const stride = width * 4;
  const data = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { data, width, height };
}

describe.skipIf(!existsSync(FIXTURE))("real NovelAI PNG fixture", () => {
  const png = existsSync(FIXTURE) ? new Uint8Array(readFileSync(FIXTURE)) : new Uint8Array();

  it("reads every NovelAI text field into the XMP packet", () => {
    const fields = pngTextFields(png);
    expect(fields.map((f) => f.keyword)).toEqual(["Title", "Description", "Software", "Source", "Generation_time", "Comment"]);
    const xmp = buildXmpPacket(fields);
    expect(xmp).toContain("<nai:Software>NovelAI</nai:Software>");
    expect(xmp).toContain("<nai:Generation_time>");
    expect(xmp).toContain("<nai:Comment>{&quot;prompt&quot;:");
    expect(xmp).not.toMatch(/exif/i);
  });

  it("finds the stealth_pngcomp header in the alpha LSBs", () => {
    expect(readStealthMagic(decodeRgba(png))).toBe("stealth_pngcomp");
  });
});
