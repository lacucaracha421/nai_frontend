/**
 * Chooses the bytes and file name for Save: WebP (default, verified) or the untouched PNG path.
 * A WebP that fails verification falls back to the PNG the PNG setting would have written.
 */
import type { FinishParams, RgbaImage } from "../finish/finishFilter";
import { finishFilename } from "../finish/finishFilter";
import type { WebpSaveRequest, WebpSaveResponse } from "./webpSave";
import { buildXmpPacket, pngTextFields } from "./xmpMetadata";

export type SaveFormat = "webp" | "png";

export type PreparedSave = { bytes: Uint8Array; filename: string; format: SaveFormat; fallback: boolean };

export type SaveDeps = {
  renderFinished(original: Uint8Array, params: FinishParams): Promise<RgbaImage>;
  encodePng(original: Uint8Array, pixels: RgbaImage): Promise<Uint8Array>;
  convertWebp(request: WebpSaveRequest, transfer: ArrayBuffer[]): Promise<WebpSaveResponse>;
};

export function withExtension(filename: string, format: SaveFormat) {
  return filename.replace(/\.(png|webp)$/i, "") + (format === "webp" ? ".webp" : ".png");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function prepareSave(
  input: { original: Uint8Array; baseName: string; format: SaveFormat; finish: FinishParams | null },
  deps: SaveDeps,
): Promise<PreparedSave> {
  const { original, format, finish } = input;
  const baseName = finish ? finishFilename(input.baseName) : input.baseName;
  const filtered = finish ? await deps.renderFinished(original, finish) : null;
  const png = async (fallback: boolean): Promise<PreparedSave> => ({
    bytes: filtered ? await deps.encodePng(original, filtered) : original,
    filename: withExtension(baseName, "png"),
    format: "png",
    fallback,
  });
  if (format === "png") return png(false);

  let response: WebpSaveResponse;
  try {
    const xmp = buildXmpPacket(pngTextFields(original));
    if (filtered) {
      // Copy: the filtered pixels are still needed for the PNG fallback.
      const data = filtered.data.slice().buffer as ArrayBuffer;
      response = await deps.convertWebp({ source: { kind: "rgba", data, width: filtered.width, height: filtered.height }, xmp }, [data]);
    } else {
      const bytes = original.slice().buffer as ArrayBuffer;
      response = await deps.convertWebp({ source: { kind: "png", bytes }, xmp }, [bytes]);
    }
  } catch (error) {
    response = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!response.ok) {
    console.warn("WebP save fell back to PNG:", response.reason);
    return png(true);
  }
  return { bytes: new Uint8Array(response.bytes), filename: withExtension(baseName, "webp"), format: "webp", fallback: false };
}
