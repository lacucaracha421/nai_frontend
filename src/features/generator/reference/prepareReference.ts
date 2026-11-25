/**
 * Prepares a user-picked or session image for NovelAI V5 Precise Reference:
 * ensures PNG bytes (scaling down oversized images to keep uploads bounded),
 * produces a base64 payload for Tauri IPC, a SHA-256 `cache_secret_key`, and
 * an object URL for thumbnail display.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_REFERENCE_SIDE = 1536;

function isPng(bytes: Uint8Array) {
  return bytes.length >= 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function bytesToBase64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await crypto.subtle.digest("SHA-256", copy);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Deterministic 64-hex fallback when WebCrypto subtle is unavailable.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  const part = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${part(h1)}${part(h2)}${part(h1 ^ h2)}${part(bytes.length)}`.repeat(2);
}

async function blobToPngBytes(blob: Blob): Promise<Uint8Array> {
  const raw = new Uint8Array(await blob.arrayBuffer());
  const dims = pngDimensions(raw);
  if (dims && Math.max(dims.width, dims.height) <= MAX_REFERENCE_SIDE) {
    return raw;
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_REFERENCE_SIDE ? MAX_REFERENCE_SIDE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("레퍼런스 이미지를 변환할 수 없습니다.");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) throw new Error("레퍼런스 이미지를 PNG로 인코딩하지 못했습니다.");
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export type PreparedReferenceImage = {
  previewUrl: string;
  pngBase64: string;
  cacheSecretKey: string;
};

export async function prepareReferenceBlob(blob: Blob): Promise<PreparedReferenceImage> {
  const pngBytes = await blobToPngBytes(blob);
  const cacheSecretKey = await sha256Hex(pngBytes);
  const pngBase64 = bytesToBase64(pngBytes);
  const previewBlob = new Blob([pngBytes as BlobPart], { type: "image/png" });
  const previewUrl = URL.createObjectURL(previewBlob);
  return { previewUrl, pngBase64, cacheSecretKey };
}

export async function prepareReferenceBytes(bytes: Uint8Array, mimeType = "image/png"): Promise<PreparedReferenceImage> {
  return prepareReferenceBlob(new Blob([bytes as BlobPart], { type: mimeType }));
}
