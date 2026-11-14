import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { watchLocalOwnerRetirement } from "@/backend/agents/local/LocalOwnerRetirement";

const log = vi.hoisted(() => vi.fn());
vi.mock("@/backend/logging/Logger", () => ({ logEvent: log }));

beforeEach(() => {
  vi.useFakeTimers();
  log.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([
  "failed",
  "succeeded",
  "cancelled",
  "work_done_closeout_open",
] as const)(
  "retires an owner of a %s run on the next tick even when normal release never arrives",
  async (status) => {
    const retire = vi.fn(async () => undefined);
    const stop = watchLocalOwnerRetirement({
      readRun: async () => ({ status }),
      retire,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(retire).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(retire).toHaveBeenCalledOnce();
    stop();
  },
);

it.each(["running", "paused", "pausing", "stopping"] as const)(
  "keeps a %s run's owner alive",
  async (status) => {
    const retire = vi.fn(async () => undefined);
    const stop = watchLocalOwnerRetirement({
      readRun: async () => ({ status }),
      retire,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(retire).not.toHaveBeenCalled();
    stop();
  },
);

it("retries unreadable run state without logging upstream content", async () => {
  const readRun = vi
    .fn()
    .mockRejectedValueOnce(new Error("private-prompt-secret"))
    .mockResolvedValue({ status: "failed" });
  const retire = vi.fn(async () => undefined);
  const stop = watchLocalOwnerRetirement({ readRun, retire });
  await vi.advanceTimersByTimeAsync(1000);
  expect(retire).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-prompt-secret");
  await vi.advanceTimersByTimeAsync(1000);
  expect(retire).toHaveBeenCalledOnce();
  stop();
});

it("retries retirement itself if the shutdown boundary temporarily refuses it", async () => {
  const retire = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValue(undefined);
  const stop = watchLocalOwnerRetirement({
    readRun: async () => ({ status: "failed" }),
    retire,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(retire).toHaveBeenCalledTimes(2);
  stop();
});
