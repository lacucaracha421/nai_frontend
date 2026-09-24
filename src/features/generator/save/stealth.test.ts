import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../finish/finishFilter";
import { alphaEquals, readStealthMagic } from "./stealth";

/** Writes `text` into alpha LSBs column by column (x outer, y inner), MSB first, like NovelAI. */
function stealthImage(text: string, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(200);
  for (let i = 3; i < data.length; i += 4) data[i] = 254;
  const bits = [...new TextEncoder().encode(text)].flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (byte >> s) & 1));
  bits.forEach((bit, index) => {
    const x = Math.floor(index / height);
    const y = index % height;
    data[(y * width + x) * 4 + 3] = 254 | bit;
  });
  return { data, width, height };
}

describe("stealth header", () => {
  it("decodes stealth_pngcomp from column-major alpha LSBs", () => {
    // Non-square with height < bits so the read wraps across several columns.
    const image = stealthImage("stealth_pngcompXYZ", 40, 7);
    expect(readStealthMagic(image)).toBe("stealth_pngcomp");
  });

  it("does not decode a row-major pattern or plain alpha", () => {
    const rowMajor = stealthImage("stealth_pngcomp", 7, 40);
    // Transpose the pattern: same bits laid out row by row.
    const transposed: RgbaImage = { data: new Uint8ClampedArray(rowMajor.data.length), width: 40, height: 7 };
    for (let y = 0; y < 40; y += 1) for (let x = 0; x < 7; x += 1) transposed.data[(x * 40 + y) * 4 + 3] = rowMajor.data[(y * 7 + x) * 4 + 3];
    expect(readStealthMagic(transposed)).toBeNull();
    const opaque: RgbaImage = { data: new Uint8ClampedArray(40 * 40 * 4).fill(255), width: 40, height: 40 };
    expect(readStealthMagic(opaque)).toBeNull();
    expect(readStealthMagic({ data: new Uint8ClampedArray(16), width: 2, height: 2 })).toBeNull();
  });

  it("compares alpha only", () => {
    const a = stealthImage("stealth_pngcomp", 16, 16);
    const b: RgbaImage = { ...a, data: a.data.slice() };
    b.data[0] = 1; // RGB change is allowed
    expect(alphaEquals(a, b)).toBe(true);
    b.data[3] ^= 1;
    expect(alphaEquals(a, b)).toBe(false);
    expect(alphaEquals(a, { ...a, width: 8, height: 32 })).toBe(false);
  });
});
