import { expect, it, vi } from "vitest";

import { AgentPlanRemoteSettlement } from "@/backend/service/agents/AgentPlanRemoteSettlement";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

it("assesses the durable step and closes the exact attempt report", async () => {
  const current = partial<AgentPlanStepResult>({
    id: "step",
    status: "failed",
    error: "failure",
  });
  const close = vi.fn(async () => null);
  const service = new AgentPlanRemoteSettlement(
    partial({
      runs: { find: async () => ({ steps: [current] }) },
      stepReports: { close },
    }),
  );
  const run = partial<AgentPlanRun>({ id: "run" });
  const remote = partial<RemotePlanStep>({
    step: { id: "step", type: "script" },
    command: { program: { kind: "script" } },
  });
  await expect(
    service.settle(run, remote, { status: "succeeded" }, "attempt"),
  ).resolves.toMatchObject({ status: "failed", error: "failure" });
  expect(close).toHaveBeenCalledWith({
    runId: "run",
    sessionScopeId: "step",
    attemptId: "attempt",
  });
});

it("uses the supplied result when the stored run is unavailable", async () => {
  const service = new AgentPlanRemoteSettlement(
    partial({ runs: { find: async () => null } }),
  );
  const run = partial<AgentPlanRun>({ id: "run" });
  const remote = partial<RemotePlanStep>({
    step: { id: "step", type: "script" },
    command: { program: { kind: "script" } },
  });
  await expect(
    service.settle(run, remote, { status: "cancelled" }, "attempt"),
  ).resolves.toEqual({ status: "cancelled" });
});
