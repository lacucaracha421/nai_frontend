/** PNG text-chunk (NovelAI prompt/seed metadata) helpers for re-encoded images. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Text chunks NovelAI uses for prompt / seed / generation metadata. */
const METADATA_CHUNK_TYPES = new Set(["tEXt", "iTXt", "zTXt"]);

type PngChunk = { type: string; start: number; end: number };

export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error("PNG 파일이 아닙니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("손상된 PNG 청크입니다.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, start: offset, end });
    offset = end;
    if (type === "IEND") break;
  }
  return chunks;
}

/** Whole text chunks (length + type + data + CRC) from `png`, in order. */
export function extractMetadataChunks(png: Uint8Array) {
  return readPngChunks(png)
    .filter((chunk) => METADATA_CHUNK_TYPES.has(chunk.type))
    .map((chunk) => png.slice(chunk.start, chunk.end));
}

/** Copies the original's PNG text chunks into `processed`, right after IHDR. */
export function copyPngMetadata(original: Uint8Array, processed: Uint8Array) {
  const metadata = extractMetadataChunks(original);
  const chunks = readPngChunks(processed);
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== "IHDR") throw new Error("PNG IHDR 청크가 없습니다.");
  const kept = chunks.slice(1).filter((chunk) => !METADATA_CHUNK_TYPES.has(chunk.type));
  const parts = [
    processed.subarray(0, ihdr.end),
    ...metadata,
    ...kept.map((chunk) => processed.subarray(chunk.start, chunk.end)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

