/** Browser implementations of the Save dependencies (finish filter + one-shot WebP worker). */
import { encodePngWithMetadata, renderFinishedPixels } from "../finish/finishImage";
import type { SaveDeps } from "./prepareSave";
import type { WebpSaveRequest, WebpSaveResponse } from "./webpSave";

const WEBP_TIMEOUT_MS = 60_000;

function convertWebpInWorker(request: WebpSaveRequest, transfer: ArrayBuffer[]) {
  return new Promise<WebpSaveResponse>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./webpSave.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      resolve({ ok: false, reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    const finish = (response: WebpSaveResponse) => {
      window.clearTimeout(timer);
      worker.terminate();
      resolve(response);
    };
    const timer = window.setTimeout(() => finish({ ok: false, reason: "timeout" }), WEBP_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<WebpSaveResponse>) => finish(event.data);
    worker.onerror = (event) => finish({ ok: false, reason: event.message || "worker error" });
    worker.postMessage(request, transfer);
  });
}

export const browserSaveDeps: SaveDeps = {
  renderFinished: renderFinishedPixels,
  encodePng: encodePngWithMetadata,
  convertWebp: convertWebpInWorker,
};
