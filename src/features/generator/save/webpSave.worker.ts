/// Web Worker entry for WebP saving (loaded with `new Worker(new URL(...), { type: "module" })`).
import type { RgbaImage } from "../finish/finishFilter";
import { handleWebpSaveRequest, type WebpCodec, type WebpSaveRequest, type WebpSaveResponse } from "./webpSave";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WebpSaveRequest>) => void) | null;
  postMessage(message: WebpSaveResponse, transfer: Transferable[]): void;
};

function context(width: number, height: number) {
  if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas unavailable");
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2d context unavailable");
  return { canvas, context };
}

async function decode(bytes: Uint8Array, type: string): Promise<RgbaImage> {
  // Unpremultiplied decode: alpha is never touched by the canvas, only RGB under alpha < 255.
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  try {
    const { context: ctx } = context(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: pixels.data, width: pixels.width, height: pixels.height };
  } finally {
    bitmap.close();
  }
}

const codec: WebpCodec = {
  decodePng: (bytes) => decode(bytes, "image/png"),
  decodeWebp: (bytes) => decode(bytes, "image/webp"),
  async encodeWebp(image, quality) {
    const { canvas, context: ctx } = context(image.width, image.height);
    const pixels = ctx.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    ctx.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    // Engines without a WebP encoder silently return PNG.
    if (blob.type !== "image/webp") throw new Error(`encoder returned ${blob.type || "unknown type"}`);
    return new Uint8Array(await blob.arrayBuffer());
  },
};

scope.onmessage = (event) => {
  void handleWebpSaveRequest(event.data, codec).then((response) =>
    scope.postMessage(response, response.ok ? [response.bytes] : []),
  );
};
