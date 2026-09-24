/// Web Worker entry: decodes an image and returns its NovelAI stealth payload text (or null).
import { readStealthText } from "../save/stealth";

export type StealthReadRequest = { bytes: ArrayBuffer; type: string };
export type StealthReadResponse = { ok: true; text: string | null } | { ok: false; reason: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StealthReadRequest>) => void) | null;
  postMessage(message: StealthReadResponse): void;
};

async function read({ bytes, type }: StealthReadRequest): Promise<StealthReadResponse> {
  if (typeof OffscreenCanvas === "undefined") return { ok: false, reason: "OffscreenCanvas unavailable" };
  // Unpremultiplied decode keeps the alpha channel (and its LSBs) exactly as stored.
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { ok: false, reason: "2d context unavailable" };
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { ok: true, text: await readStealthText({ data: pixels.data, width: pixels.width, height: pixels.height }) };
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (event) => {
  void read(event.data)
    .catch((error: unknown): StealthReadResponse => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }))
    .then((response) => scope.postMessage(response));
};
