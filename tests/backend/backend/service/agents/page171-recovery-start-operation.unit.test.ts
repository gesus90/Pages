import { expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { readPlanRecoveryCommand } from "@/backend/agents/AgentPlanRecoveryInput";
import { translatePlanError } from "@/backend/service/agents/AgentPlanOperationErrors";
import { startRecoveredPlanRun } from "@/backend/service/agents/AgentPlanRecoveryStartOperation";

import { recoveryFixture } from "./page84-recovery-fixture";
import { PlanWorld } from "./plan-operation-world";

import type { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import type { AgentPlanRecoveryErrorCode } from "@/definition/AgentPlanRecovery";

it("requests an explicit restart of the selected saved revision through the existing recovery service", async () => {
  const { failed: run } = await recoveryFixture();
  const control = vi.fn<AgentPlanRecoveryService["control"]>(async () => ({
    commandId: "decision-1",
    revision: 4,
    outcome: "started",
    runId: "new-run",
  }));
  const services = { plans: { run: async () => run }, recovery: { control } };

  const result = await startRecoveredPlanRun(services, run.userId, "restart", {
    operationId: "restart-operation",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 3,
    expectedPlanRevision: 5,
    confirmRepeat: true,
  });

  expect(result).toMatchObject({
    planId: run.planId,
    runId: run.id,
    startedRunId: "new-run",
    action: "restart",
    recoveryRevision: 4,
    outcome: "started",
  });
  expect(control).toHaveBeenCalledOnce();
  expect(control.mock.calls[0]?.slice(0, 2)).toEqual([run.userId, run.id]);
  const command = readPlanRecoveryCommand(control.mock.calls[0]?.[2]);
  expect(command).toMatchObject({
    action: "restart",
    revision: 5,
    expectedRevision: 3,
    confirmRepeat: true,
  });
  expect(command.idempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
});

it("requires an explicit recovery mode and the reviewed step IDs when continuing", async () => {
  const { failed: run } = await recoveryFixture();
  const control = vi.fn<AgentPlanRecoveryService["control"]>(async () => ({
    commandId: "decision-2",
    revision: 1,
    outcome: "started",
    runId: "new-run",
  }));
  const services = { plans: { run: async () => run }, recovery: { control } };
  const request = {
    operationId: "resume-operation",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
    expectedPlanRevision: 5,
    mode: "new_session",
    reviewedStepIds: ["b"],
  };

  await expect(
    startRecoveredPlanRun(services, run.userId, "resume", request),
  ).resolves.toMatchObject({ action: "resume", startedRunId: "new-run" });
  expect(control.mock.calls[0]?.slice(0, 2)).toEqual([run.userId, run.id]);
  const command = readPlanRecoveryCommand(control.mock.calls[0]?.[2]);
  expect(command).toMatchObject({
    action: "resume",
    mode: "new_session",
    revision: 5,
    reviewedStepIds: ["b"],
    expectedRevision: 0,
  });
  expect(command.idempotencyKey).toMatch(/^[a-f0-9]{64}$/u);
  await expect(
    startRecoveredPlanRun(services, run.userId, "resume", {
      ...request,
      mode: "live",
    }),
  ).rejects.toBeInstanceOf(AgentOperationError);
  expect(control).toHaveBeenCalledOnce();
});

it("does not start a different plan or accept an unconfirmed repeat", async () => {
  const { failed: run } = await recoveryFixture();
  const control = vi.fn<AgentPlanRecoveryService["control"]>();
  const services = { plans: { run: async () => run }, recovery: { control } };
  const request = {
    operationId: "restart-operation",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
    expectedPlanRevision: 1,
    confirmRepeat: true,
  };

  await expect(
    startRecoveredPlanRun(services, run.userId, "restart", {
      ...request,
      planId: "other",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    startRecoveredPlanRun(services, run.userId, "restart", {
      ...request,
      confirmRepeat: false,
    }),
  ).rejects.toBeInstanceOf(AgentOperationError);
  expect(control).not.toHaveBeenCalled();
});

it.each(["plans.run.recovery.restart", "plans.run.recovery.resume"])(
  "refuses %s to run-scoped credentials",
  async (operation) => {
    const world = new PlanWorld();
    const identity = {
      ...world.identity("owner"),
      run: {
        runId: "session-run",
        stepId: "session-step",
        operations: [],
        tickets: [],
        reach: "full" as const,
      },
    };
    await expect(
      world.operations.handle(identity, operation, {}),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  },
);

it.each<[AgentPlanRecoveryErrorCode, string]>([
  ["review_required", "plan_recovery_review_required"],
  ["native_resume_unavailable", "plan_recovery_native_resume_unavailable"],
  ["checkpoint_invalid", "plan_recovery_checkpoint_invalid"],
  ["checkpoint_too_large", "plan_recovery_checkpoint_too_large"],
  ["workflow_unavailable", "plan_recovery_workflow_unavailable"],
])("preserves the %s recovery refusal for clients", (code, reason) => {
  expect(translatePlanError(new AgentPlanRecoveryError(code))).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason },
  });
});
