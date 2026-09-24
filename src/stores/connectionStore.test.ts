import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getNovelAiQuota } from "../adapters/novelai/client";
import { useConnectionStore } from "./connectionStore";
vi.mock("../adapters/novelai/client", () => ({
  isTauriRuntime: () => true, getNovelAiQuota: vi.fn(), clearNovelAiToken: vi.fn(),
  restoreNovelAiToken: vi.fn(), setNovelAiToken: vi.fn(), testNovelAiConnection: vi.fn(),
}));
beforeEach(() => {
  vi.useFakeTimers();
  useConnectionStore.setState({ ...useConnectionStore.getInitialState(), status: "connected" });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("timestamps successful quota replies and retains the original clock on a failed refresh", async () => {
  const quota = { anlas: 1, subscriptionAnlas: 1, paidAnlas: 0, tier: 3,
    usage: { percent: 72, isNegative: false, timeUntilNextPercent: 120 } };
  vi.mocked(getNovelAiQuota).mockResolvedValue(quota);
  vi.setSystemTime(1000);
  await useConnectionStore.getState().refreshQuota();
  expect(useConnectionStore.getState().quotaReceivedAt).toBe(1000);
  vi.setSystemTime(61_000);
  vi.mocked(getNovelAiQuota).mockRejectedValueOnce(new Error("offline"));
  await useConnectionStore.getState().refreshQuota();
  expect(useConnectionStore.getState()).toMatchObject({ quota, quotaReceivedAt: 1000 });
  vi.mocked(getNovelAiQuota).mockResolvedValue({ ...quota, usage: { ...quota.usage, timeUntilNextPercent: 45 } });
  await useConnectionStore.getState().refreshQuota();
  expect(useConnectionStore.getState().quotaReceivedAt).toBe(61_000);
  await useConnectionStore.getState().disconnect();
  expect(useConnectionStore.getState()).toMatchObject({ quota: null, quotaReceivedAt: null });
});
