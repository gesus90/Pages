import { expect, it, vi } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { claimRemoteJob } from "@/backend/service/agents/AgentPlanRemoteClaim";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { RunnerJob } from "@/definition/RunnerProtocol";

const RUN = partial<AgentPlanRun>({
  id: "run",
  planId: "plan",
  planRevision: 3,
  userId: "user",
});
const REMOTE = partial<RemotePlanStep>({
  step: { id: "step" },
  target: { connectionId: "connection" },
  command: { version: 1 },
});

it("binds the exact run revision and attempt to a durable job", async () => {
  const job = partial<RunnerJob>({ jobId: "job" });
  const enqueue = vi.fn(async () => job);
  await expect(
    claimRemoteJob({
      runners: { enqueue },
      run: RUN,
      remote: REMOTE,
      attemptId: "attempt",
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual(job);
  expect(enqueue).toHaveBeenCalledWith(
    "user",
    "connection",
    {
      planId: "plan",
      runId: "run",
      stepId: "step",
      attemptId: "attempt",
      planRevision: 3,
    },
    REMOTE.command,
  );
});

it("uses the retry path and treats a durable cancellation as no claim", async () => {
  const enqueue = vi.fn(async () => partial<RunnerJob>({}));
  const enqueueRetry = vi.fn(async () => {
    throw new AgentPlanCancelledError();
  });
  await expect(
    claimRemoteJob({
      runners: { enqueue, enqueueRetry },
      run: RUN,
      remote: REMOTE,
      attemptId: "attempt",
      signal: new AbortController().signal,
      allowTerminalRerun: true,
    }),
  ).resolves.toBeNull();
  expect(enqueueRetry).toHaveBeenCalledOnce();
  expect(enqueue).not.toHaveBeenCalled();
  const controller = new AbortController();
  controller.abort();
  await expect(
    claimRemoteJob({
      runners: { enqueue },
      run: RUN,
      remote: REMOTE,
      attemptId: "attempt",
      signal: controller.signal,
    }),
  ).resolves.toBeNull();
});
