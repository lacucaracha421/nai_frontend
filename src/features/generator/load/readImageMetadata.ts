/**
 * Reads NovelAI generation metadata from a PNG or WebP file. Sources are tried in order and the
 * first one carrying NovelAI fields wins:
 *   1. PNG `tEXt` / `iTXt` / `zTXt` chunks (`Comment` JSON, `Description`, `Software`, `Source`, …);
 *   2. the WebP `XMP ` chunk with the `nai:` elements this app (and NovelAI) write;
 *   3. stealth metadata in the alpha-channel LSBs (see `save/stealth.ts` for the bit layout).
 * Pixel decoding for (3) is injected so the browser can run it in a worker and tests can fake it.
 */
import { readPngChunks } from "../finish/pngMetadata";
import { decompressBytes } from "../save/stealth";
import { isWebp, readWebpChunks } from "../save/webpContainer";
import type { TextField } from "../save/xmpMetadata";

export type MetadataSource = "png-text" | "webp-xmp" | "stealth";
export type ImageMetadata = { source: MetadataSource; fields: Record<string, string> };
export type ImageKind = "png" | "webp";

/** Returns the stealth payload text for the image's pixels, or null when there is none. */
export type StealthReader = (bytes: Uint8Array, kind: ImageKind) => Promise<string | null>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "png";
  if (isWebp(bytes)) return "webp";
  return null;
}

/** tEXt is Latin-1 by spec, but NovelAI writes UTF-8 there; ASCII decodes the same either way. */
function decodeLatin1OrUtf8(bytes: Uint8Array) {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/** Every tEXt / iTXt / zTXt field in file order, compressed ones inflated. Unreadable chunks are skipped. */
export async function readPngTextFields(png: Uint8Array): Promise<TextField[]> {
  const fields: TextField[] = [];
  for (const chunk of readPngChunks(png)) {
    if (chunk.type !== "tEXt" && chunk.type !== "iTXt" && chunk.type !== "zTXt") continue;
    const data = png.subarray(chunk.start + 8, chunk.end - 4);
    const keywordEnd = data.indexOf(0);
    if (keywordEnd <= 0) continue;
    const keyword = latin1.decode(data.subarray(0, keywordEnd));
    try {
      if (chunk.type === "tEXt") {
        fields.push({ keyword, text: decodeLatin1OrUtf8(data.subarray(keywordEnd + 1)) });
      } else if (chunk.type === "zTXt") {
        // keyword \0 method(0 = zlib) compressed-text
        const text = await decompressBytes(data.subarray(keywordEnd + 2), "deflate");
        fields.push({ keyword, text: decodeLatin1OrUtf8(text) });
      } else {
        // iTXt: keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
        const compressed = data[keywordEnd + 1] === 1;
        const languageEnd = data.indexOf(0, keywordEnd + 3);
        const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) continue;
        const raw = data.subarray(translatedEnd + 1);
        fields.push({ keyword, text: utf8.decode(compressed ? await decompressBytes(raw, "deflate") : raw) });
      }
    } catch {
      // A corrupt compressed chunk should not hide the other fields.
    }
  }
  return fields;
}

function unescapeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    const lower = name.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** `nai:` fields from an XMP packet, as elements (`<nai:Comment>…</nai:Comment>`) or attributes. */
export function parseXmpFields(xmp: string): TextField[] {
  const fields: TextField[] = [];
  for (const match of xmp.matchAll(/<nai:([A-Za-z_][\w.-]*)>([\s\S]*?)<\/nai:\1>/g)) {
    fields.push({ keyword: match[1], text: unescapeXml(match[2]) });
  }
  for (const match of xmp.matchAll(/\snai:([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
    fields.push({ keyword: match[1], text: unescapeXml(match[2]) });
  }
  return fields;
}

export function readWebpXmpFields(webp: Uint8Array): TextField[] {
  const chunk = readWebpChunks(webp).find((item) => item.fourcc === "XMP ");
  return chunk ? parseXmpFields(utf8.decode(chunk.payload)) : [];
}

/** Stealth payloads are a JSON object of field → text (values that are not strings are re-serialized). */
export function parseStealthFields(text: string): TextField[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([keyword, value]) => ({ keyword, text: typeof value === "string" ? value : JSON.stringify(value) }));
}

function asRecord(fields: TextField[]) {
  const record: Record<string, string> = {};
  for (const { keyword, text } of fields) if (!(keyword in record)) record[keyword] = text;
  return record;
}

/** NovelAI fields are present when there is a `Comment` (generation JSON) or a `Description` (prompt). */
function hasNovelAiFields(record: Record<string, string>) {
  return Boolean(record.Comment?.trim() || record.Description?.trim());
}

export async function readImageMetadata(bytes: Uint8Array, readStealth: StealthReader): Promise<ImageMetadata | null> {
  const kind = imageKind(bytes);
  if (!kind) return null;

  const text = asRecord(kind === "png" ? await readPngTextFields(bytes) : readWebpXmpFields(bytes));
  if (hasNovelAiFields(text)) return { source: kind === "png" ? "png-text" : "webp-xmp", fields: text };

  const stealthText = await readStealth(bytes, kind);
  const stealth = stealthText ? asRecord(parseStealthFields(stealthText)) : {};
  if (hasNovelAiFields(stealth)) return { source: "stealth", fields: stealth };
  return null;
}
