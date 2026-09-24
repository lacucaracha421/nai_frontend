/**
 * Browser-only glue for the finish filter: PNG decode/encode on a canvas, the shared worker runner,
 * and per-image preview sources. The cached original PNG is only read, never written.
 */
import { readImageBytes } from "../../../adapters/novelai/client";
import type { GenerationImage } from "../../../types/generation";
import { type FinishParams, type RgbaImage } from "./finishFilter";
import { createFinishRunner, type FinishWorkerLike } from "./finishProtocol";
import { copyPngMetadata } from "./pngMetadata";

/** Long side of the live stage preview while adjusting. */
export const FINISH_PREVIEW_LONG_SIDE = 1200;
/** Long side of the preset-card thumbnails. */
export const FINISH_THUMB_LONG_SIDE = 240;

export const finishRunner = createFinishRunner(
  () => new Worker(new URL("./finish.worker.ts", import.meta.url), { type: "module" }) as unknown as FinishWorkerLike,
);

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("마무리 필터용 캔버스를 만들지 못했습니다.");
  return context;
}

function decodeBitmap(bytes: Uint8Array) {
  return createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
}

/** Draws the bitmap at most `maxLongSide` pixels on its long side (full size when omitted). */
function bitmapPixels(bitmap: ImageBitmap, maxLongSide?: number): RgbaImage {
  const scale = maxLongSide ? Math.min(1, maxLongSide / Math.max(bitmap.width, bitmap.height)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = context2d(canvas);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: pixels.data, width: pixels.width, height: pixels.height };
}

async function encodePngBlob(image: RgbaImage) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = context2d(canvas);
  const pixels = context.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  context.putImageData(pixels, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("마무리 PNG를 만들지 못했습니다."))), "image/png"),
  );
}

export async function imageObjectUrl(image: RgbaImage) {
  return URL.createObjectURL(await encodePngBlob(image));
}

type PreviewSource = { preview: RgbaImage; thumb: RgbaImage };
const SOURCE_CACHE_LIMIT = 4;
// Downscaled pixels of recent session images, keyed by cached original path.
const sourceCache = new Map<string, Promise<PreviewSource>>();

export function finishPreviewSource(image: GenerationImage) {
  let pending = sourceCache.get(image.filePath);
  if (!pending) {
    pending = readImageBytes(image.src).then(async (bytes) => {
      const bitmap = await decodeBitmap(bytes);
      try {
        return { preview: bitmapPixels(bitmap, FINISH_PREVIEW_LONG_SIDE), thumb: bitmapPixels(bitmap, FINISH_THUMB_LONG_SIDE) };
      } finally {
        bitmap.close();
      }
    });
    pending.catch(() => sourceCache.delete(image.filePath));
    sourceCache.set(image.filePath, pending);
    while (sourceCache.size > SOURCE_CACHE_LIMIT) sourceCache.delete(sourceCache.keys().next().value!);
  }
  return pending;
}

/** Full-resolution filtered pixels of the original; alpha is copied unchanged. */
export async function renderFinishedPixels(original: Uint8Array, params: FinishParams) {
  const bitmap = await decodeBitmap(original);
  let pixels: RgbaImage;
  try {
    pixels = bitmapPixels(bitmap);
  } finally {
    bitmap.close();
  }
  return finishRunner.run(pixels, params);
}

/** PNG of `pixels` carrying the original's NovelAI text chunks. */
export async function encodePngWithMetadata(original: Uint8Array, pixels: RgbaImage) {
  const blob = await encodePngBlob(pixels);
  return copyPngMetadata(original, new Uint8Array(await blob.arrayBuffer()));
}

