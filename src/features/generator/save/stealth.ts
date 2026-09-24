/**
 * NovelAI "stealth" metadata: bits in the alpha-channel LSBs, read column by column.
 *
 * Layout (verified against NovelAI-generated PNGs and the community `stealth_pnginfo` readers):
 * - bit order: x outer, y inner (column-major), most significant bit of each byte first;
 * - bytes 0–14: ASCII magic `stealth_pnginfo` (plain UTF-8 payload) or `stealth_pngcomp` (gzip payload);
 * - bytes 15–18: payload length in **bits**, unsigned 32-bit big-endian;
 * - then the payload: a UTF-8 JSON object of the PNG text fields (`Description`, `Comment`, …).
 */
import type { RgbaImage } from "../finish/finishFilter";

export const STEALTH_MAGIC_LENGTH = 15;

/** `length` bytes from the alpha LSBs starting at byte `offset` (x outer, y inner; MSB first). */
export function readStealthBytes(image: RgbaImage, length = STEALTH_MAGIC_LENGTH, offset = 0) {
  const { data, width, height } = image;
  const out = new Uint8Array(length);
  const first = offset * 8;
  const last = Math.min((offset + length) * 8, width * height);
  for (let bit = first; bit < last; bit += 1) {
    const x = Math.floor(bit / height);
    const y = bit % height;
    const index = bit - first;
    out[index >> 3] |= (data[(y * width + x) * 4 + 3] & 1) << (7 - (index & 7));
  }
  return out;
}

const STEALTH_HEADER_BYTES = STEALTH_MAGIC_LENGTH + 4;

/** Decompresses with the platform `DecompressionStream` (WebView, Web Worker and Node). */
export async function decompressBytes(bytes: Uint8Array, format: "gzip" | "deflate") {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The stealth payload as UTF-8 text (normally JSON), or null when the image carries none. */
export async function readStealthText(image: RgbaImage): Promise<string | null> {
  const magic = readStealthMagic(image);
  if (magic !== "stealth_pngcomp" && magic !== "stealth_pnginfo") return null;
  const capacity = image.width * image.height;
  if (capacity < STEALTH_HEADER_BYTES * 8) return null;
  const lengthBytes = readStealthBytes(image, 4, STEALTH_MAGIC_LENGTH);
  const bitLength = new DataView(lengthBytes.buffer).getUint32(0, false);
  if (bitLength === 0 || bitLength % 8 !== 0 || STEALTH_HEADER_BYTES * 8 + bitLength > capacity) return null;
  const payload = readStealthBytes(image, bitLength / 8, STEALTH_HEADER_BYTES);
  const bytes = magic === "stealth_pngcomp" ? await decompressBytes(payload, "gzip") : payload;
  return new TextDecoder("utf-8").decode(bytes);
}

/** `stealth_pngcomp` / `stealth_pnginfo` when present, otherwise null. */
export function readStealthMagic(image: RgbaImage) {
  if (image.width * image.height < STEALTH_MAGIC_LENGTH * 8) return null;
  const magic = String.fromCharCode(...readStealthBytes(image));
  return magic.startsWith("stealth_png") ? magic : null;
}

export function alphaEquals(a: RgbaImage, b: RgbaImage) {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let index = 3; index < a.data.length; index += 4) if (a.data[index] !== b.data[index]) return false;
  return true;
}
