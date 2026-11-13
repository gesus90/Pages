import { beforeEach, expect, it, vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { acquirePlanWriters } from "@/backend/service/agents/AgentPlanRunLifecycle";
import { planControl } from "@/backend/service/agents/AgentPlanControl";
import { persistPlanResourceWaits } from "@/backend/service/agents/resources/PlanResourceWait";
import { AcpWaitDiagnostics } from "@/backend/service/agents/resources/AcpWaitDiagnostics";

import { owner } from "./page81-resource-fixture";
import { parameterRunFixture } from "./page55-run-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { EngineDependencies } from "@/backend/service/agents/AgentPlanEngineDependencies";
import type { WaitingRequest } from "@/backend/service/agents/resources/AcpAdmissionRequest";

const boundaries = vi.hoisted(() => ({
  logEvent: vi.fn(),
  contexts: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: boundaries.logEvent,
  logCaughtError: vi.fn(),
  withLogContext: (context: unknown, action: () => unknown) => { boundaries.contexts(context); return action(); },
}));
vi.mock("@/backend/service/agents/AgentPlanContinuation", () => ({ planWritingWorkspaces: () => ["local-directory:/synthetic/workspace"] }));

beforeEach(() => { vi.clearAllMocks(); });

it("exposes only the authorized run's current ACP wait reason through run parsing and control", async () => {
  const { run, snapshot } = await parameterRunFixture();
  const active: ActivePlanRun = {
    view: run, snapshot, groupCloseout: "open", hasPersistenceFailure: false,
    dispatched: new Set(), controllers: new Map(), executions: new Set(),
  };
  const waiting = [{ ...owner("waiting"), runId: run.id, since: run.startedAt, reason: "capacity" as const }];
  const update = vi.fn(async () => undefined);
  await persistPlanResourceWaits([active], waiting, { update });
  const view = active.view;
  expect(update).toHaveBeenCalledWith(view);
  expect(readPlanRun(view).waitReason).toBe("capacity");
  const plan = { ...snapshot.plan, projectName: "Synthetic project", canEdit: true, github: null };
  expect(planControl(plan, view, { userId: run.userId, hasReservation: true }).waitReason).toBe("capacity");
  await persistPlanResourceWaits([active], waiting, { update });
  expect(update).toHaveBeenCalledOnce();
  await persistPlanResourceWaits([active], [], { update });
  expect(readPlanRun(active.view).waitReason).toBeUndefined();
  expect(update).toHaveBeenCalledTimes(2);
  expect(readPlanRun({ ...view, status: "succeeded" }).waitReason).toBeUndefined();
  expect(planControl(plan, view, { userId: "other", hasReservation: true }).waitReason).toBeUndefined();
});

it("persists the workspace wait and reason, logs it once, and clears it when the resource is acquired", async () => {
  const { run, snapshot } = await parameterRunFixture();
  const active: ActivePlanRun = {
    view: run, snapshot, groupCloseout: "open", hasPersistenceFailure: false,
    dispatched: new Set(), controllers: new Map(), executions: new Set(),
  };
  const blocker = { resource: "workspace", reason: "cleanup_unconfirmed", runId: "holder", jobId: null, attemptId: null };
  const reserve = vi.fn(async () => false);
  const update = vi.fn(async () => undefined);
  const runs = { reserve, resourceBlocker: async () => blocker, update,
    insert: vi.fn<EngineDependencies["runs"]["insert"]>(),
    create: vi.fn<EngineDependencies["runs"]["create"]>(),
    find: vi.fn<EngineDependencies["runs"]["find"]>(),
  };
  const dependencies: EngineDependencies = {
    runs,
    start: { control: vi.fn() },
    steps: { run: vi.fn(), closeGroups: vi.fn() },
  };
  await expect(acquirePlanWriters(active, dependencies)).resolves.toBe(false);
  expect(readPlanRun(active.view)).toMatchObject({ isWaitingForWorkspace: true, workspaceWait: blocker });
  expect(update).toHaveBeenCalledWith(active.view);
  expect(boundaries.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "agent.workspace.waiting", metadata: { runId: run.id, reason: blocker.reason } }));
  expect(boundaries.contexts).toHaveBeenCalledWith(expect.objectContaining({ runId: run.id }));
  await acquirePlanWriters(active, dependencies);
  expect(boundaries.logEvent).toHaveBeenCalledOnce();
  reserve.mockResolvedValue(true);
  await expect(acquirePlanWriters(active, dependencies)).resolves.toBe(true);
  expect(active.view.workspaceWait).toBeUndefined();
  expect(active.view.isWaitingForWorkspace).toBe(false);
});

it("writes each changed ACP reason once with the waiting run's log context", () => {
  const request: WaitingRequest = { owner: owner("waiter"), since: "now", signal: new AbortController().signal, resolve: vi.fn(), reject: vi.fn(), abort: vi.fn() };
  const diagnostics = new AcpWaitDiagnostics();
  diagnostics.report([request], () => "capacity");
  diagnostics.report([request], () => "capacity");
  expect(boundaries.logEvent).toHaveBeenCalledOnce();
  diagnostics.report([request], () => "memory");
  expect(boundaries.logEvent).toHaveBeenCalledTimes(2);
  expect(boundaries.contexts).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-waiter", stepId: "step", jobId: undefined, attemptId: undefined }));
  expect(boundaries.logEvent).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Waiting for an ACP place: memory", metadata: { runId: "run-waiter", stepId: "step", reason: "memory" } }));
});
