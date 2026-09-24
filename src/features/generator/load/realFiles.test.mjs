// "불러오기" against the user's real NovelAI files when they exist on this machine.
// Files are read in place and never copied into the repository. WebP/PNG pixels for the stealth
// path are decoded with Python + Pillow (test only; skipped when unavailable).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStealthText } from "../save/stealth";
import { mapNovelAiMetadata } from "./mapNovelAiMetadata";
import { readImageMetadata } from "./readImageMetadata";

const PNG = "/home/laku/바탕화면/NovelAI_20260920_183313_seed2181637352.png";
const XMP_ONLY = "/home/laku/바탕화면/webp-test/F_손실90_XMP만.webp";
const NO_INFO = "/home/laku/바탕화면/webp-test/D_손실90_정보없음.webp";
const SEED = 2181637352;

const DECODE = [
  "import sys",
  "from PIL import Image",
  "im = Image.open(sys.argv[1]).convert('RGBA')",
  "w, h = im.size",
  "sys.stdout.buffer.write(w.to_bytes(4, 'big') + h.to_bytes(4, 'big') + im.tobytes())",
].join("\n");

function pillowAvailable() {
  try {
    execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const hasPillow = pillowAvailable();

/** Stealth reader backed by Pillow: exact straight-alpha RGBA like the worker's unpremultiplied decode. */
async function pillowStealth(bytes, kind, path) {
  const out = execFileSync("python3", ["-c", DECODE, path], { maxBuffer: 256 * 1024 * 1024 });
  const width = out.readUInt32BE(0);
  const height = out.readUInt32BE(4);
  return readStealthText({ data: new Uint8ClampedArray(out.buffer, out.byteOffset + 8, width * height * 4), width, height });
}

const read = (path) => new Uint8Array(readFileSync(path));
const neverStealth = async () => {
  throw new Error("stealth should not be needed");
};

describe.skipIf(!existsSync(PNG))("real NovelAI PNG", () => {
  it("loads from the PNG text chunks with the exact seed", async () => {
    const metadata = await readImageMetadata(read(PNG), neverStealth);
    expect(metadata?.source).toBe("png-text");
    const loaded = mapNovelAiMetadata(metadata.fields, { qualityPrompt: "high complexity" });
    expect(loaded.settings).toMatchObject({ seed: SEED, steps: 28, guidance: 4, guidanceRescale: 0.2, width: 832, height: 1216, sampler: "k_euler_ancestral", noiseSchedule: "karras", model: "nai-diffusion-5-full" });
    expect(loaded.characters).toEqual([{ prompt: "keroro gunsou, hinata natsumi", negative: "", position: { x: 0.29686946, y: 0.38612437 } }]);
    expect(loaded.skipped).toEqual([]);
  });

  it.skipIf(!hasPillow)("also carries the same data in its stealth alpha", async () => {
    const text = await pillowStealth(null, "png", PNG);
    expect(JSON.parse(JSON.parse(text).Comment).seed).toBe(SEED);
  });
});

describe.skipIf(!existsSync(XMP_ONLY))("real WebP with XMP only (F)", () => {
  it("loads from XMP with the exact seed", async () => {
    const metadata = await readImageMetadata(read(XMP_ONLY), neverStealth);
    expect(metadata?.source).toBe("webp-xmp");
    expect(mapNovelAiMetadata(metadata.fields, { qualityPrompt: "" }).settings.seed).toBe(SEED);
  });
});

describe.skipIf(!existsSync(NO_INFO) || !hasPillow)("real WebP without metadata chunks (D)", () => {
  it("loads through the stealth alpha with the exact seed", async () => {
    const metadata = await readImageMetadata(read(NO_INFO), (bytes, kind) => pillowStealth(bytes, kind, NO_INFO));
    expect(metadata?.source).toBe("stealth");
    const loaded = mapNovelAiMetadata(metadata.fields, { qualityPrompt: "" });
    expect(loaded.settings.seed).toBe(SEED);
    expect(loaded.characters).toHaveLength(1);
  });
});
