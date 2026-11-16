import { afterEach, expect, it, vi } from "vitest";

import { withRemoteProgress } from "@/backend/service/agents/AgentPlanRemoteProgress";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";

afterEach(() => {
  vi.useRealTimers();
});

it("adds transport facts without altering the stored run", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  const run = partial<AgentPlanRun>({
    id: "run",
    steps: [
      {
        id: "remote",
        execution: {
          attemptId: "attempt",
          target: { kind: "remote", connectionId: "connection" },
        },
        remote: { startedAt: "started", closeout: "confirmed" },
      },
      { id: "local" },
    ],
  });
  const job = partial<RunnerJob>({
    jobId: "job",
    sessionId: "session",
    status: "running",
    observedAt: "2026-01-01T00:00:00Z",
  });
  const progress = vi.fn(async () => job);
  const result = await withRemoteProgress(run, {
    progress,
    historyPending: async () => 2,
    contact: () => null,
  });
  expect(result.steps[0]?.remote).toMatchObject({
    jobId: "job",
    historyPending: 2,
    isObservationStale: true,
    startedAt: "started",
    closeout: "confirmed",
  });
  expect(result.steps[1]).toEqual(run.steps[1]);
  expect(run.steps[0]?.remote?.jobId).toBeUndefined();
  expect(progress).toHaveBeenCalledWith("connection", "run", "attempt");
});

it("leaves missing jobs unchanged and does not mark completed jobs stale", async () => {
  const run = partial<AgentPlanRun>({
    id: "run",
    steps: [
      {
        execution: {
          attemptId: "attempt",
          target: { kind: "remote", connectionId: "connection" },
        },
      },
    ],
  });
  const runners = {
    progress: async () => undefined,
    historyPending: async () => 0,
    contact: () => null,
  };
  await expect(withRemoteProgress(run, runners)).resolves.toEqual(run);
  const job = partial<RunnerJob>({
    jobId: "job",
    sessionId: "session",
    status: "completed",
    observedAt: null,
  });
  const result = await withRemoteProgress(run, {
    ...runners,
    progress: async () => job,
  });
  expect(result.steps[0]?.remote?.isObservationStale).toBe(false);
});
