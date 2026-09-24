/** Browser implementation of the stealth reader: a one-shot worker decodes the pixels off the UI thread. */
import type { StealthReader } from "./readImageMetadata";
import type { StealthReadRequest, StealthReadResponse } from "./stealthRead.worker";

const STEALTH_TIMEOUT_MS = 30_000;

export const browserStealthReader: StealthReader = (bytes, kind) =>
  new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./stealthRead.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error);
      return;
    }
    const finish = (response: StealthReadResponse) => {
      window.clearTimeout(timer);
      worker.terminate();
      if (response.ok) resolve(response.text);
      else reject(new Error(response.reason));
    };
    const timer = window.setTimeout(() => finish({ ok: false, reason: "timeout" }), STEALTH_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<StealthReadResponse>) => finish(event.data);
    worker.onerror = (event) => finish({ ok: false, reason: event.message || "worker error" });
    const copy = bytes.slice().buffer as ArrayBuffer;
    const request: StealthReadRequest = { bytes: copy, type: kind === "png" ? "image/png" : "image/webp" };
    worker.postMessage(request, [copy]);
  });
