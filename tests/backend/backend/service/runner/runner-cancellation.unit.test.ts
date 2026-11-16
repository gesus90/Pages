import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RunnerCancellation } from "@/backend/service/runner/RunnerCancellation";
import { RUNNER_STOP_DEADLINE_MILLISECONDS } from "@/backend/service/runner/RunnerStopState";

import { partial } from "../../../app/lib/service-wiring-fakes";

const find = vi.fn();
const checkpoint = vi.fn();
const expire = vi.fn();
const deliver = vi.fn();
const job = {
  jobId: "job",
  sessionId: "session",
  plan: { attemptId: "attempt" },
};
const writes = { run: async (work: () => Promise<void>) => work() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  vi.resetAllMocks();
  find.mockResolvedValue({ state: { jobs: [job] } });
});
afterEach(() => vi.useRealTimers());

it("checkpoints stop intent before delivering it to the runner", async () => {
  const cancellation = new RunnerCancellation(
    partial<ConstructorParameters<typeof RunnerCancellation>[0]>({
      repository: { find, checkpoint },
      writes,
      expire,
      deliver,
    }),
  );
  await cancellation.request("connection", "job");
  expect(checkpoint).toHaveBeenCalledWith(
    "connection",
    expect.objectContaining({
      jobs: [
        expect.objectContaining({
          cancellation: { requestedAt: "2026-01-01T00:00:00.000Z" },
        }),
      ],
    }),
  );
  expect(deliver).toHaveBeenCalledWith("connection", {
    version: 1,
    type: "cancel",
    jobId: "job",
    sessionId: "session",
    attemptId: "attempt",
    requestedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
    deliver.mock.invocationCallOrder[0],
  );
});

it("expires an unconfirmed stop at its deadline", async () => {
  const cancellation = new RunnerCancellation(
    partial<ConstructorParameters<typeof RunnerCancellation>[0]>({
      repository: { find, checkpoint },
      writes,
      expire,
      deliver,
    }),
  );
  await cancellation.request("connection", "job");
  const requested = {
    ...job,
    cancellation: { requestedAt: "2026-01-01T00:00:00.000Z" },
  };
  find.mockResolvedValue({ state: { jobs: [requested] } });
  await vi.advanceTimersByTimeAsync(RUNNER_STOP_DEADLINE_MILLISECONDS);
  expect(expire).toHaveBeenCalledWith("connection", requested);
});

it("does not dispatch absent, unbound or confirmed jobs", async () => {
  const cancellation = new RunnerCancellation(
    partial<ConstructorParameters<typeof RunnerCancellation>[0]>({
      repository: { find, checkpoint },
      writes,
      expire,
      deliver,
    }),
  );
  find
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ state: { jobs: [{ jobId: "job" }] } })
    .mockResolvedValueOnce({
      state: { jobs: [{ ...job, cancellation: { closeout: "confirmed" } }] },
    });
  await cancellation.request("connection", "job");
  await cancellation.request("connection", "job");
  await cancellation.request("connection", "job");
  expect(checkpoint).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
});
