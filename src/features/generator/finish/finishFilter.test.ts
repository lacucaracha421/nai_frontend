import { describe, expect, it } from "vitest";
import {
  FINISH_NEUTRAL,
  FINISH_PRESETS,
  applyFinish,
  chromaticStage,
  colorStage,
  finalizeStage,
  finishParamsEqual,
  glowStage,
  paperStage,
  sanitizeFinishParams,
  scaledPixelParams,
  sharpenStage,
  toPlanes,
  type FinishParams,
  type RgbaImage,
} from "./finishFilter";

function testImage(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4;
    data[o] = (x * 255) / width;
    data[o + 1] = (y * 255) / height;
    data[o + 2] = (x ^ y) & 255;
    data[o + 3] = (x + y) % 3 === 0 ? 254 : 255; // stealth-metadata style alpha LSBs
  }
  return { data, width, height };
}

function fnv1a(bytes: Uint8ClampedArray) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const reference = testImage(832, 1216);

describe("finish filter", () => {
  it("is deterministic and matches the prototype output at the reference size", () => {
    // Keep the original strong prototype parameters as an engine regression fixture.
    // Checksums were produced by the tuned grain-lab.html prototype's own render() on this image.
    expect(fnv1a(applyFinish(reference, {
      temp: 6, curve: 14, lift: 4, sat: 106, glow: 35, gthr: 72, grad: 16,
      chroma: 0.75, vig: 10, pstr: 0, pscale: 100, strength: 3.5, sharp: 30,
    }).data)).toBe("799cc814");
    expect(fnv1a(applyFinish(reference, {
      temp: 3, curve: 0, lift: 6, sat: 94, glow: 0, gthr: 75, grad: 14,
      chroma: 0, vig: 0, pstr: 55, pscale: 120, strength: 2, sharp: 0,
    }).data)).toBe("b36f9502");
    const small = testImage(60, 90);
    expect(applyFinish(small, FINISH_PRESETS.anime, 11).data).toEqual(applyFinish(small, FINISH_PRESETS.anime, 11).data);
    expect(applyFinish(small, FINISH_PRESETS.anime, 11).data).not.toEqual(applyFinish(small, FINISH_PRESETS.anime, 12).data);
  });

  it("copies alpha byte-for-byte and never mutates the source", () => {
    const source = testImage(97, 131);
    const before = new Uint8ClampedArray(source.data);
    const extreme = { ...FINISH_NEUTRAL, temp: 50, curve: 60, lift: 25, sat: 130, glow: 100, gthr: 40, grad: 40, chroma: 3, vig: 40, pstr: 100, pscale: 250, strength: 20, sharp: 150 };
    for (const params of [FINISH_PRESETS.anime, FINISH_PRESETS.watercolor, FINISH_NEUTRAL, extreme]) {
      const out = applyFinish(source, params);
      for (let i = 3; i < out.data.length; i += 4) {
        if (out.data[i] !== source.data[i]) throw new Error(`alpha changed at ${i}`);
      }
    }
    expect(source.data).toEqual(before);
  });

  it("returns the input unchanged at neutral values", () => {
    const source = testImage(73, 101);
    expect(applyFinish(source, FINISH_PRESETS.off).data).toEqual(source.data);
  });

  it("makes every stage a no-op at its neutral value", () => {
    const source = testImage(41, 57);
    const { width: w, height: h } = source;
    const planes = () => toPlanes(source);
    const expectSame = (actual: Float32Array[], tolerance = 0) => {
      const expected = planes();
      for (let c = 0; c < 3; c++) for (let i = 0; i < expected[c].length; i++) {
        if (Math.abs(actual[c][i] - expected[c][i]) > tolerance) throw new Error(`plane ${c} differs at ${i}`);
      }
    };
    expectSame(sharpenStage(planes(), w, h, 0, 1));
    expectSame(chromaticStage(planes(), w, h, 0));
    expectSame(colorStage(planes(), FINISH_NEUTRAL), 1e-9);
    expectSame(glowStage(planes(), w, h, 0, 75, 14));
    expectSame(paperStage(planes(), w, h, 0, 100, 1));
    expect(finalizeStage(planes(), source, 0, 0, 1.5, 1)).toEqual(source.data);
  });

  it("changes the image when any single setting moves off neutral", () => {
    const source = testImage(608, 912);
    const neutral = applyFinish(source, FINISH_NEUTRAL).data;
    const changes: Partial<FinishParams>[] = [
      { temp: 20 }, { curve: 30 }, { lift: 10 }, { sat: 80 },
      { glow: 80, gthr: 40 }, { chroma: 3 }, { vig: 40 },
      { pstr: 80 }, { strength: 10 }, { sharp: 150 },
    ];
    for (const change of changes) {
      expect(applyFinish(source, { ...FINISH_NEUTRAL, ...change }).data, JSON.stringify(change)).not.toEqual(neutral);
    }
  });
});

describe("finish presets and settings", () => {
  it("defines the exact preset values", () => {
    expect(FINISH_PRESETS.anime).toEqual({
      temp: 2, curve: 5, lift: 2, sat: 102, glow: 12, gthr: 78, grad: 16,
      chroma: 0.2, vig: 3, pstr: 0, pscale: 100, strength: 1.2, sharp: 10,
    });
    expect(FINISH_PRESETS.watercolor).toEqual({
      temp: 1, curve: 0, lift: 2, sat: 98, glow: 0, gthr: 75, grad: 14,
      chroma: 0, vig: 0, pstr: 20, pscale: 120, strength: 0.7, sharp: 0,
    });
    expect(FINISH_PRESETS.off).toEqual({
      temp: 0, curve: 0, lift: 0, sat: 100, glow: 0, gthr: 75, grad: 14,
      chroma: 0, vig: 0, pstr: 0, pscale: 100, strength: 0, sharp: 0,
    });
    expect(Object.isFrozen(FINISH_PRESETS.anime)).toBe(true);
  });

  it("scales pixel-sized settings with the image's long side (reference 1216 px)", () => {
    const anime = FINISH_PRESETS.anime;
    expect(scaledPixelParams(anime, 832, 1216)).toEqual({ glowRadius: 16, chromaShift: 0.2, paperScale: 100, grainSize: 1.5, sharpenRadius: 1 });
    expect(scaledPixelParams(anime, 1664, 2432)).toEqual({ glowRadius: 32, chromaShift: 0.4, paperScale: 200, grainSize: 3, sharpenRadius: 2 });
    // Landscape uses the long side too.
    expect(scaledPixelParams(anime, 2432, 1664)).toEqual(scaledPixelParams(anime, 1664, 2432));
    const preview = scaledPixelParams(anime, 821, 1200);
    expect(preview.glowRadius).toBeCloseTo((16 * 1200) / 1216, 10);
    // Grain never goes below one pixel on tiny thumbnails.
    expect(scaledPixelParams(anime, 160, 240).grainSize).toBe(1);
  });

  it("clamps and fills persisted settings", () => {
    const cleaned = sanitizeFinishParams({ temp: 999, sat: "x", chroma: -1, bogus: 3 }, FINISH_PRESETS.watercolor);
    expect(cleaned).toEqual({ ...FINISH_PRESETS.watercolor, temp: 50, chroma: 0 });
    expect(sanitizeFinishParams(null)).toEqual(FINISH_PRESETS.anime);
    expect(finishParamsEqual(cleaned, FINISH_PRESETS.watercolor)).toBe(false);
  });
});
