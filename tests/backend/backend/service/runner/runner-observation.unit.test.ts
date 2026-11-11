import { afterEach, expect, it, vi } from "vitest";

import { RunnerObservation } from "@/backend/service/runner/RunnerObservation";

import type { RunnerJob } from "@/definition/RunnerProtocol";

const JOB: RunnerJob = {
  jobId: "job",
  sessionId: "session",
  status: "queued",
  plan: {
    planId: "plan",
    runId: "run",
    stepId: "step",
    attemptId: "attempt",
    planRevision: 1,
  },
};

afterEach(() => vi.useRealTimers());

it("sends opening observations immediately and throttles renewals per plan", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const observation = new RunnerObservation();
  const send = vi.fn();
  observation.configure("runner", [JOB], true);
  observation.attach("runner", send);

  observation.observe("other", true);
  observation.observe("plan", true);
  observation.observe("plan", false);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    type: "observation",
    planId: "plan",
    leaseMilliseconds: 30_000,
    refresh: true,
  });
  vi.advanceTimersByTime(10_000);
  observation.observe("plan", false);
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    type: "observation",
    planId: "plan",
    leaseMilliseconds: 30_000,
    refresh: false,
  });
  observation.observe("plan", true);
  expect(send).toHaveBeenCalledTimes(3);
});

it("replays only unexpired views on attachment and after reconnect", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const observation = new RunnerObservation();
  const send = vi.fn();
  observation.observe("plan", true);
  observation.configure("runner", [JOB, { ...JOB, plan: undefined }], false);
  observation.attach("runner", send);
  expect(send).not.toHaveBeenCalled();
  observation.configure("runner", [JOB], true);
  vi.advanceTimersByTime(5_000);
  observation.attach("runner", send);
  expect(send).toHaveBeenCalledWith({
    version: 1,
    type: "observation",
    planId: "plan",
    leaseMilliseconds: 25_000,
    refresh: true,
  });
  observation.attach("runner", send);
  expect(send).toHaveBeenCalledTimes(1);
  observation.detach("runner");
  observation.configure("runner", [JOB], true);
  observation.attach("runner", send);
  expect(send).toHaveBeenCalledTimes(2);
  observation.detach("runner");
  vi.advanceTimersByTime(25_000);
  observation.observe("another", true);
  observation.configure("runner", [JOB], true);
  observation.attach("runner", send);
  expect(send).toHaveBeenCalledTimes(2);
});
