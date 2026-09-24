/**
 * WebP save pipeline (runs in a Web Worker): encode lossy WebP, add the XMP packet, then decode
 * the result and prove the alpha plane (NovelAI stealth metadata) and XMP survived.
 * Codec access is injected so the checks are testable without a browser.
 */
import type { RgbaImage } from "../finish/finishFilter";
import { alphaEquals, readStealthMagic } from "./stealth";
import { hasWebpChunk, injectWebpXmp, isWebp } from "./webpContainer";

export const WEBP_QUALITY = 0.9;

export type WebpCodec = {
  decodePng(bytes: Uint8Array): Promise<RgbaImage>;
  encodeWebp(image: RgbaImage, quality: number): Promise<Uint8Array>;
  decodeWebp(bytes: Uint8Array): Promise<RgbaImage>;
};

export type WebpSaveRequest = {
  source: { kind: "png"; bytes: ArrayBuffer } | { kind: "rgba"; data: ArrayBuffer; width: number; height: number };
  xmp: string;
};

export type WebpSaveResponse = { ok: true; bytes: ArrayBuffer } | { ok: false; reason: string };

export async function encodeVerifiedWebp(source: RgbaImage, xmp: string, codec: WebpCodec): Promise<WebpSaveResponse> {
  const encoded = await codec.encodeWebp(source, WEBP_QUALITY);
  if (!isWebp(encoded)) return { ok: false, reason: "encoder did not produce WebP" };
  const bytes = injectWebpXmp(encoded, xmp, source.width, source.height);
  if (!hasWebpChunk(bytes, "XMP ") || hasWebpChunk(bytes, "EXIF")) return { ok: false, reason: "metadata chunk check failed" };
  const decoded = await codec.decodeWebp(bytes);
  if (!alphaEquals(source, decoded)) return { ok: false, reason: "alpha changed" };
  const magic = readStealthMagic(source);
  if (magic && readStealthMagic(decoded) !== magic) return { ok: false, reason: "stealth header lost" };
  return { ok: true, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

export async function handleWebpSaveRequest(request: WebpSaveRequest, codec: WebpCodec): Promise<WebpSaveResponse> {
  try {
    const { source } = request;
    const image =
      source.kind === "png"
        ? await codec.decodePng(new Uint8Array(source.bytes))
        : { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height };
    return await encodeVerifiedWebp(image, request.xmp, codec);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
