import { expect, it } from "vitest";

import {
  completedGatedRemote,
  remoteAssessmentTerms,
  requiresRemoteAcceptance,
  settleRemoteAcceptance,
} from "@/backend/service/agents/AgentPlanRemoteAcceptance";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const REMOTE = partial<RemotePlanStep>({
  step: { type: "agent" },
  command: { program: { kind: "cli" } },
});

it("requires acceptance only for a CLI agent", () => {
  expect(requiresRemoteAcceptance(REMOTE)).toBe(true);
  expect(
    requiresRemoteAcceptance(
      partial<RemotePlanStep>({ ...REMOTE, step: { type: "script" } }),
    ),
  ).toBe(false);
  expect(remoteAssessmentTerms(REMOTE)).toBeNull();
});

it("does not accept a success without confirmed closeout and assessment inputs", async () => {
  const result = partial<AgentPlanStepResult>({
    status: "succeeded",
    session: { resultCode: 0, acceptance: null },
    remote: { closeout: "unconfirmed" },
  });
  await expect(
    settleRemoteAcceptance({
      remote: REMOTE,
      run: partial<AgentPlanRun>({}),
      result,
      tasks: undefined,
      projectId: async () => "project",
    }),
  ).resolves.toMatchObject({
    status: "failed",
    error: "plan_acceptance_unavailable",
    session: { resultCode: -1, acceptance: null },
  });
  const failed = partial<AgentPlanStepResult>({
    status: "failed",
    error: "existing",
  });
  await expect(
    settleRemoteAcceptance({
      remote: REMOTE,
      run: partial<AgentPlanRun>({}),
      result: failed,
      tasks: undefined,
      projectId: async () => "project",
    }),
  ).resolves.toEqual(failed);
});

it("makes a completed gated remote result provisional success for the engine", () => {
  const running = partial<AgentPlanStepResult>({
    status: "running",
    remote: { status: "completed" },
    session: { resultCode: null },
  });
  expect(completedGatedRemote(REMOTE, running)).toMatchObject({
    status: "succeeded",
    session: { resultCode: 0 },
  });
  expect(
    completedGatedRemote(REMOTE, { ...running, status: "failed" }),
  ).toMatchObject({ status: "failed" });
});
