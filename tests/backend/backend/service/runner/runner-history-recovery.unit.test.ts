import { afterEach, expect, it, vi } from "vitest";

import { RunnerHistoryRecovery } from "@/backend/service/runner/RunnerHistoryRecovery";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerHistoryRecoveryRepository } from "@/backend/database/repositories/runner/RunnerHistoryRecoveryRepository";

afterEach(() => {
  vi.useRealTimers();
});

it("shares a running recovery for the same connection", async () => {
  let finish: (count: number) => void = () => {};
  const restore = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const service = new RunnerHistoryRecovery(
    partial<RunnerHistoryRecoveryRepository>({
      restore,
      hasPending: async () => false,
    }),
    { shouldRecover: false },
  );
  const first = service.restore("connection");
  const second = service.restore("connection");
  expect(restore).toHaveBeenCalledOnce();
  finish(1);
  await Promise.all([first, second]);
});

it("retries pending history promptly after progress and more slowly after a failure", async () => {
  vi.useFakeTimers();
  const restore = vi
    .fn()
    .mockResolvedValueOnce(1)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(0);
  const hasPending = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const service = new RunnerHistoryRecovery(
    partial<RunnerHistoryRecoveryRepository>({ restore, hasPending }),
    { shouldRecover: false },
  );
  await service.restore("connection");
  await vi.advanceTimersByTimeAsync(250);
  expect(restore).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(restore).toHaveBeenCalledTimes(3);
});
