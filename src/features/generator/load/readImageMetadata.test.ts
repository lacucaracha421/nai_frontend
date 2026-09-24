import { describe, expect, it, vi } from "vitest";
import { readStealthText } from "../save/stealth";
import { injectWebpXmp } from "../save/webpContainer";
import { buildXmpPacket, pngTextFields } from "../save/xmpMetadata";
import { imageKind, parseXmpFields, readImageMetadata, readPngTextFields, readWebpXmpFields } from "./readImageMetadata";
import { pngWithText, simpleWebp, stealthImage, v5Comment } from "./testFixtures";

const noStealth = vi.fn(async () => null);

describe("PNG text chunks", () => {
  it("reads tEXt, compressed and uncompressed iTXt, and zTXt in file order", async () => {
    const png = await pngWithText([
      { type: "tEXt", keyword: "Description", text: "1girl, café" },
      { type: "iTXt", keyword: "Software", text: "NovelAI" },
      { type: "iTXt", keyword: "Comment", text: '{"seed": 7}', compressed: true },
      { type: "zTXt", keyword: "Source", text: "NovelAI Diffusion V5 0ADF9AB7" },
    ]);
    expect(await readPngTextFields(png)).toEqual([
      { keyword: "Description", text: "1girl, café" },
      { keyword: "Software", text: "NovelAI" },
      { keyword: "Comment", text: '{"seed": 7}' },
      { keyword: "Source", text: "NovelAI Diffusion V5 0ADF9AB7" },
    ]);
  });

  it("wins over stealth metadata and reports its source", async () => {
    const png = await pngWithText([{ type: "tEXt", keyword: "Comment", text: v5Comment() }]);
    const stealth = vi.fn(async () => "{}");
    const result = await readImageMetadata(png, stealth);
    expect(result?.source).toBe("png-text");
    expect(JSON.parse(result!.fields.Comment).seed).toBe(2181637352);
    expect(stealth).not.toHaveBeenCalled();
  });
});

describe("WebP XMP", () => {
  it("round-trips the app's own XMP writer, including escaped JSON", async () => {
    const png = await pngWithText([
      { type: "tEXt", keyword: "Description", text: "a & b <c>" },
      { type: "tEXt", keyword: "Comment", text: v5Comment() },
      { type: "tEXt", keyword: "Generation_time", text: "2.4" },
    ]);
    const webp = injectWebpXmp(simpleWebp(), buildXmpPacket(pngTextFields(png)), 832, 1216);
    expect(imageKind(webp)).toBe("webp");
    expect(readWebpXmpFields(webp)).toEqual(pngTextFields(png));
    const result = await readImageMetadata(webp, noStealth);
    expect(result?.source).toBe("webp-xmp");
    expect(result?.fields.Description).toBe("a & b <c>");
    expect(JSON.parse(result!.fields.Comment).v4_prompt.caption.char_captions).toHaveLength(2);
  });

  it("also accepts attribute-style nai: fields and numeric entities", () => {
    expect(parseXmpFields('<rdf:Description nai:Software="Novel&#65;I" nai:Title="x &amp;lt; y"/>')).toEqual([
      { keyword: "Software", text: "NovelAI" },
      { keyword: "Title", text: "x &lt; y" },
    ]);
  });
});

describe("stealth alpha metadata", () => {
  const fields = { Description: "1girl", Software: "NovelAI", Comment: v5Comment() };

  it("decodes a gzip payload (stealth_pngcomp)", async () => {
    const image = await stealthImage("stealth_pngcomp", JSON.stringify(fields), 96, 50);
    expect(JSON.parse((await readStealthText(image))!)).toEqual(fields);
  });

  it("decodes a plain payload (stealth_pnginfo)", async () => {
    const image = await stealthImage("stealth_pnginfo", JSON.stringify(fields), 200, 64);
    expect(JSON.parse((await readStealthText(image))!)).toEqual(fields);
  });

  it("returns null for plain alpha and for a length that does not fit", async () => {
    expect(await readStealthText({ data: new Uint8ClampedArray(40 * 40 * 4).fill(255), width: 40, height: 40 })).toBeNull();
    const image = await stealthImage("stealth_pnginfo", "{}", 20, 20);
    // Corrupt the length to claim more bits than the image holds: flip bit 8 of the length field.
    const bit = 15 * 8 + 8;
    const index = ((bit % 20) * 20 + Math.floor(bit / 20)) * 4 + 3;
    image.data[index] ^= 1;
    expect(await readStealthText(image)).toBeNull();
  });

  it("is used when the file has no text metadata, and converts object values", async () => {
    const png = await pngWithText([{ type: "tEXt", keyword: "Software", text: "Other app" }]);
    const reader = vi.fn(async () => JSON.stringify({ Description: "1girl", Comment: { seed: 5 } }));
    const result = await readImageMetadata(png, reader);
    expect(reader).toHaveBeenCalledWith(png, "png");
    expect(result).toEqual({ source: "stealth", fields: { Description: "1girl", Comment: '{"seed":5}' } });
  });
});

describe("no metadata", () => {
  it("returns null for a plain PNG, a plain WebP, and a non-image", async () => {
    expect(await readImageMetadata(await pngWithText([]), noStealth)).toBeNull();
    expect(await readImageMetadata(simpleWebp(), noStealth)).toBeNull();
    expect(await readImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), noStealth)).toBeNull();
  });
});
