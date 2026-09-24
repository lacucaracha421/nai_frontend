import { describe, expect, it } from "vitest";
import { FINISH_FIXED, FINISH_PRESETS, applyFinish, type RgbaImage } from "./finishFilter";
import {
  FinishSupersededError,
  createFinishRunner,
  handleFinishRequest,
  type FinishRequest,
  type FinishResponse,
  type FinishWorkerLike,
} from "./finishProtocol";

function image(width = 24, height = 36): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 255;
  return { data, width, height };
}

/** A fake worker that answers with the real handler, asynchronously, and records messages. */
class FakeWorker implements FinishWorkerLike {
  onmessage: ((event: MessageEvent<FinishResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: { message: FinishRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  hold = false;
  private waiting: FinishRequest[] = [];

  postMessage(message: FinishRequest, transfer: Transferable[]) {
    this.posted.push({ message, transfer });
    this.waiting.push(message);
    if (!this.hold) queueMicrotask(() => this.flush());
  }
  flush() {
    for (const message of this.waiting.splice(0)) {
      this.onmessage?.({ data: handleFinishRequest(message) } as MessageEvent<FinishResponse>);
    }
  }
  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
  terminate() {
    this.terminated = true;
  }
}

describe("finish worker contract", () => {
  it("handles a request exactly like applyFinish and reports bad input", () => {
    const source = image();
    const response = handleFinishRequest({
      id: 5, width: source.width, height: source.height, data: source.data.slice().buffer,
      params: FINISH_PRESETS.anime, seed: FINISH_FIXED.seed,
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.id).toBe(5);
    expect(new Uint8ClampedArray(response.data)).toEqual(applyFinish(source, FINISH_PRESETS.anime).data);

    const bad = handleFinishRequest({ id: 6, width: 10, height: 10, data: new ArrayBuffer(12), params: FINISH_PRESETS.anime, seed: 1 });
    expect(bad).toMatchObject({ id: 6, ok: false });
  });

  it("posts a transferable copy, keeps the caller's pixels and resolves with the result", async () => {
    const workers: FakeWorker[] = [];
    const runner = createFinishRunner(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const source = image();
    const before = new Uint8ClampedArray(source.data);
    const out = await runner.run(source, FINISH_PRESETS.watercolor);

    expect(workers).toHaveLength(1);
    const [{ message, transfer }] = workers[0].posted;
    expect(message).toMatchObject({ width: 24, height: 36, params: FINISH_PRESETS.watercolor, seed: FINISH_FIXED.seed });
    expect(transfer).toEqual([message.data]);
    expect(message.data).not.toBe(source.data.buffer);
    expect(source.data).toEqual(before);
    expect(out.data).toEqual(applyFinish(source, FINISH_PRESETS.watercolor).data);
  });

  it("runs one job at a time and replaces a queued job in the same lane", async () => {
    const worker = new FakeWorker();
    worker.hold = true;
    const runner = createFinishRunner(() => worker);
    const source = image();

    const first = runner.run(source, FINISH_PRESETS.anime, { lane: "stage" });
    const stale = runner.run(source, FINISH_PRESETS.watercolor, { lane: "stage" });
    const latest = runner.run(source, FINISH_PRESETS.off, { lane: "stage" });
    const other = runner.run(source, FINISH_PRESETS.anime, { lane: "thumb" });

    await expect(stale).rejects.toBeInstanceOf(FinishSupersededError);
    expect(worker.posted).toHaveLength(1); // only the in-flight job was sent
    worker.hold = false;
    worker.flush();

    await expect(first).resolves.toMatchObject({ width: 24, height: 36 });
    expect((await latest).data).toEqual(source.data); // neutral
    await other;
    expect(worker.posted.map((entry) => entry.message.params)).toEqual([FINISH_PRESETS.anime, FINISH_PRESETS.off, FINISH_PRESETS.anime]);
  });

  it("rejects the running job on a worker error and starts a fresh worker for the next one", async () => {
    const workers: FakeWorker[] = [];
    const runner = createFinishRunner(() => {
      const worker = new FakeWorker();
      worker.hold = workers.length === 0;
      workers.push(worker);
      return worker;
    });
    const failing = runner.run(image(), FINISH_PRESETS.anime);
    workers[0].fail("boom");
    await expect(failing).rejects.toThrow("boom");
    expect(workers[0].terminated).toBe(true);

    await expect(runner.run(image(), FINISH_PRESETS.anime)).resolves.toMatchObject({ width: 24 });
    expect(workers).toHaveLength(2);
  });
});
