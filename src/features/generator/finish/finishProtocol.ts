/** Message contract between the UI and the finish-filter Web Worker, plus a small serial job runner. */
import { applyFinish, sanitizeFinishParams, FINISH_FIXED, type FinishParams, type RgbaImage } from "./finishFilter";

export type FinishRequest = {
  id: number;
  width: number;
  height: number;
  /** RGBA bytes, transferred to the worker. */
  data: ArrayBuffer;
  params: FinishParams;
  seed: number;
};

export type FinishResponse =
  | { id: number; ok: true; width: number; height: number; data: ArrayBuffer }
  | { id: number; ok: false; error: string };

/** Worker side: runs one request. Pure apart from allocation, so it is testable without a Worker. */
export function handleFinishRequest(request: FinishRequest): FinishResponse {
  try {
    const { id, width, height } = request;
    if (request.data.byteLength !== width * height * 4) throw new Error("이미지 크기와 픽셀 데이터가 맞지 않습니다.");
    const params = sanitizeFinishParams(request.params);
    const out = applyFinish({ data: new Uint8ClampedArray(request.data), width, height }, params, request.seed);
    return { id, ok: true, width, height, data: out.data.buffer as ArrayBuffer };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The subset of `Worker` the runner uses (lets tests pass a fake). */
export type FinishWorkerLike = {
  postMessage(message: FinishRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<FinishResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
};

/** Rejection for a queued job replaced by a newer job in the same lane (e.g. slider moved again). */
export class FinishSupersededError extends Error {
  constructor() {
    super("finish job superseded");
    this.name = "FinishSupersededError";
  }
}

type Job = {
  image: RgbaImage;
  params: FinishParams;
  seed: number;
  lane: string | undefined;
  resolve: (image: RgbaImage) => void;
  reject: (error: unknown) => void;
};

/**
 * Runs filter jobs one at a time on a lazily created worker. A queued (not yet started) job is
 * replaced when a newer job arrives in the same lane, so fast slider changes never pile up.
 */
export function createFinishRunner(createWorker: () => FinishWorkerLike) {
  let worker: FinishWorkerLike | null = null;
  let nextId = 1;
  let inflight: (Job & { id: number }) | null = null;
  const queue: Job[] = [];

  const settle = (fn: (job: Job) => void) => {
    const job = inflight;
    inflight = null;
    if (job) fn(job);
    pump();
  };

  function ensureWorker() {
    if (worker) return worker;
    const created = createWorker();
    created.onmessage = (event) => {
      const response = event.data;
      if (!inflight || response.id !== inflight.id) return;
      settle((job) => {
        if (response.ok) job.resolve({ data: new Uint8ClampedArray(response.data), width: response.width, height: response.height });
        else job.reject(new Error(response.error));
      });
    };
    created.onerror = (event) => {
      created.terminate();
      if (worker === created) worker = null;
      settle((job) => job.reject(new Error(event.message || "마무리 필터 작업이 실패했습니다.")));
    };
    worker = created;
    return created;
  }

  function pump() {
    if (inflight) return;
    const job = queue.shift();
    if (!job) return;
    const id = nextId++;
    inflight = { ...job, id };
    // Copy so the caller keeps its source pixels; the copy's buffer is transferred.
    const data = job.image.data.slice().buffer as ArrayBuffer;
    try {
      ensureWorker().postMessage(
        { id, width: job.image.width, height: job.image.height, data, params: job.params, seed: job.seed },
        [data],
      );
    } catch (error) {
      settle((failed) => failed.reject(error));
    }
  }

  return {
    run(image: RgbaImage, params: FinishParams, options: { lane?: string; seed?: number } = {}) {
      return new Promise<RgbaImage>((resolve, reject) => {
        const job: Job = { image, params, seed: options.seed ?? FINISH_FIXED.seed, lane: options.lane, resolve, reject };
        if (job.lane !== undefined) {
          const index = queue.findIndex((queued) => queued.lane === job.lane);
          if (index >= 0) queue.splice(index, 1)[0].reject(new FinishSupersededError());
        }
        queue.push(job);
        pump();
      });
    },
  };
}

export type FinishRunner = ReturnType<typeof createFinishRunner>;
