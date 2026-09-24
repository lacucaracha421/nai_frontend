/**
 * Minimal WebP RIFF container editing: adds an XMP chunk (and a VP8X header when the encoder
 * wrote the simple format). NovelAI rejects files carrying EXIF, so EXIF is always dropped.
 */

export type WebpChunk = { fourcc: string; payload: Uint8Array };

const VP8X_FLAG_ALPHA = 0x10;
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;
const VP8L_SIGNATURE = 0x2f;

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

/** Chunks in file order (payload without padding). Throws on a truncated or non-WebP file. */
export function readWebpChunks(bytes: Uint8Array): WebpChunk[] {
  if (!isWebp(bytes)) throw new Error("WebP 파일이 아닙니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const chunks: WebpChunk[] = [];
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > riffEnd) throw new Error("손상된 WebP 청크입니다.");
    chunks.push({ fourcc: ascii(bytes, offset, 4), payload: bytes.subarray(start, start + size) });
    offset = start + size + (size & 1);
  }
  return chunks;
}

export function writeWebpChunks(chunks: WebpChunk[]) {
  const length = 12 + chunks.reduce((total, chunk) => total + 8 + chunk.payload.length + (chunk.payload.length & 1), 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, length - 8, true);
  out.set(new TextEncoder().encode("WEBP"), 8);
  let offset = 12;
  for (const chunk of chunks) {
    out.set(new TextEncoder().encode(chunk.fourcc), offset);
    view.setUint32(offset + 4, chunk.payload.length, true);
    out.set(chunk.payload, offset + 8);
    offset += 8 + chunk.payload.length + (chunk.payload.length & 1);
  }
  return out;
}

export function hasWebpChunk(bytes: Uint8Array, fourcc: string) {
  return readWebpChunks(bytes).some((chunk) => chunk.fourcc === fourcc);
}

function vp8lHasAlpha(payload: Uint8Array) {
  if (payload.length < 5 || payload[0] !== VP8L_SIGNATURE) return false;
  const bits = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(1, true);
  return ((bits >>> 28) & 1) === 1;
}

function vp8xPayload(flags: number, width: number, height: number) {
  if (width < 1 || height < 1 || width > 1 << 24 || height > 1 << 24) throw new Error("WebP 캔버스 크기가 올바르지 않습니다.");
  const payload = new Uint8Array(10);
  payload[0] = flags;
  const w = width - 1;
  const h = height - 1;
  payload.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
  return payload;
}

/**
 * Returns a copy of `webp` with `xmp` as its only metadata: a VP8X header with the XMP flag
 * (created from `width`/`height` for simple-format files), `ALPH` right before `VP8 `, any old
 * `XMP ` / `EXIF` chunks removed, and the new `XMP ` chunk last.
 */
export function injectWebpXmp(webp: Uint8Array, xmp: string, width: number, height: number) {
  const chunks = readWebpChunks(webp).filter((chunk) => chunk.fourcc !== "XMP " && chunk.fourcc !== "EXIF");
  if (chunks.some((chunk) => chunk.fourcc === "ANIM" || chunk.fourcc === "ANMF")) throw new Error("애니메이션 WebP는 지원하지 않습니다.");
  const image = chunks.find((chunk) => chunk.fourcc === "VP8 " || chunk.fourcc === "VP8L");
  if (!image) throw new Error("WebP 이미지 데이터가 없습니다.");
  const alph = chunks.filter((chunk) => chunk.fourcc === "ALPH");
  const existing = chunks.find((chunk) => chunk.fourcc === "VP8X");
  const others = chunks.filter((chunk) => chunk !== image && chunk !== existing && chunk.fourcc !== "ALPH");

  let flags: number;
  let header: Uint8Array;
  if (existing) {
    if (existing.payload.length < 10) throw new Error("손상된 VP8X 청크입니다.");
    header = existing.payload.slice();
    flags = header[0];
  } else {
    flags = alph.length > 0 || (image.fourcc === "VP8L" && vp8lHasAlpha(image.payload)) ? VP8X_FLAG_ALPHA : 0;
    header = vp8xPayload(flags, width, height);
  }
  header[0] = (flags | VP8X_FLAG_XMP) & ~VP8X_FLAG_EXIF;

  // Spec order: VP8X, ICCP, ALPH, VP8/VP8L, (EXIF), XMP; unknown chunks keep their relative order.
  const iccp = others.filter((chunk) => chunk.fourcc === "ICCP");
  const trailing = others.filter((chunk) => chunk.fourcc !== "ICCP");
  return writeWebpChunks([
    { fourcc: "VP8X", payload: header },
    ...iccp,
    ...(image.fourcc === "VP8 " ? alph : []),
    image,
    ...trailing,
    { fourcc: "XMP ", payload: new TextEncoder().encode(xmp) },
  ]);
}
