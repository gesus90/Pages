import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import {
  ADMIN,
  createPlanContext,
  planRun,
  planView,
} from "./agent-plan-service-harness";

import type { PlanContext } from "./agent-plan-service-harness";
import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const boundary = vi.hoisted(() => ({
  controls: {
    read: vi.fn<() => Promise<Partial<AgentPlanControl>>>(),
    rejectionHistory: vi.fn<() => Promise<object>>(),
  },
  readRun: vi.fn<() => Promise<AgentPlanRun>>(),
}));

vi.mock("@/backend/service/agents/AgentPlanControlService", () => ({
  AgentPlanControlService: vi.fn(function () {
    return boundary.controls;
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanStartActions", () => ({
  AgentPlanStartActions: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanRunReader", async (original) => ({
  ...(await original<object>()),
  readAuthorizedPlanRun: boundary.readRun,
}));

beforeEach(() => {
  vi.clearAllMocks();
  boundary.readRun.mockImplementation(async () => planRun());
});

function resumable(
  run: AgentPlanRun = planRun({ status: "paused" }),
): PlanContext {
  const context = createPlanContext();
  boundary.readRun.mockResolvedValue(run);
  context.mocks.runs.find.mockResolvedValue(run);
  boundary.controls.read.mockResolvedValue({ canEdit: false });
  return context;
}

describe("AgentPlanService.resume", () => {
  it("adopts the saved draft at the pause boundary of the run", async () => {
    const { service, mocks } = resumable();
    const snapshot = { snapshot: true };
    mocks.preparation.prepare.mockResolvedValue(snapshot);
    const journal = vi.fn(async () => undefined);

    const resumed = await service.resume("owner", "run-1", 1, journal);

    expect(mocks.preparation.prepare).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ id: "plan-1" }),
    );
    expect(mocks.engine.resume).toHaveBeenCalledWith(
      "run-1",
      snapshot,
      journal,
    );
    expect(resumed.status).toBe("paused");
  });

  it("refuses when the person cannot edit the plan", async () => {
    const { service, mocks } = resumable();
    mocks.access.require.mockResolvedValue(planView({ canEdit: false }));

    await expect(service.resume("owner", "run-1", 1)).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("reports a conflict when the call names no revision", async () => {
    const { service, mocks } = resumable();

    await expect(service.resume("owner", "run-1")).rejects.toThrow(
      new AgentError("plan_conflict"),
    );
    expect(mocks.engine.resume).not.toHaveBeenCalled();
  });

  it("reports a conflict when the plan moved past the revision", async () => {
    const { service, mocks } = resumable();

    await expect(service.resume("owner", "run-1", 7)).rejects.toThrow(
      new AgentError("plan_conflict"),
    );
    expect(mocks.engine.resume).not.toHaveBeenCalled();
  });

  it("returns a run that already continues with the revision", async () => {
    const run = planRun({
      status: "running",
      continuation: {
        planRevision: 1,
        version: 2,
        adoptedAt: "2026-01-01 09:00:00",
      },
    });
    const { service, mocks } = resumable(run);

    expect(await service.resume("owner", "run-1", 1)).toBe(run);
    expect(mocks.engine.resume).not.toHaveBeenCalled();
  });

  it("refuses a run that is no longer paused", async () => {
    const { service } = resumable(planRun({ status: "running" }));

    await expect(service.resume("owner", "run-1", 1)).rejects.toThrow(
      new AgentError("plan_run_unavailable"),
    );
  });

  it("refuses a run that has a stop requested", async () => {
    const { service } = resumable(
      planRun({ status: "paused", stopRequested: true }),
    );

    await expect(service.resume("owner", "run-1", 1)).rejects.toThrow(
      new AgentError("plan_run_unavailable"),
    );
  });

  it("refuses when the continuation was deleted", async () => {
    const { service, mocks } = resumable();
    boundary.controls.read.mockResolvedValue({
      canEdit: false,
      issue: "plan_continuation_deleted",
    });

    await expect(service.resume("owner", "run-1", 1)).rejects.toThrow(
      new AgentError("plan_continuation_deleted"),
    );
    expect(mocks.engine.resume).not.toHaveBeenCalled();
  });
});

describe("AgentPlanService.control", () => {
  it("returns the control state untouched when nobody edits or no run exists", async () => {
    const { service, mocks } = createPlanContext();
    boundary.controls.read.mockResolvedValueOnce({
      canEdit: false,
      runId: "run-1",
    });
    boundary.controls.read.mockResolvedValueOnce({ canEdit: true });

    expect(await service.control("owner", "plan-1")).toEqual({
      canEdit: false,
      runId: "run-1",
    });
    expect(await service.control("owner", "plan-1")).toEqual({ canEdit: true });
    expect(mocks.runs.find).not.toHaveBeenCalled();
  });

  it("keeps the control state while the person may read the history of the run", async () => {
    const { service, mocks } = createPlanContext();
    const control = { canEdit: true, runId: "run-1", canStop: true };
    boundary.controls.read.mockResolvedValue(control);
    mocks.runs.find.mockResolvedValue(planRun());

    expect(await service.control("owner", "plan-1")).toBe(control);
  });

  it("reduces the control state to stop and restart when the history is denied", async () => {
    const { service, mocks } = createPlanContext();
    boundary.controls.read.mockResolvedValue({
      canEdit: true,
      canStop: true,
      canRestart: true,
      runId: "run-1",
    });
    mocks.runs.find.mockResolvedValue(planRun({ status: "paused" }));
    boundary.readRun.mockRejectedValue(
      new AgentError("workspace_access_denied"),
    );

    expect(await service.control("owner", "plan-1")).toMatchObject({
      runId: "run-1",
      status: "paused",
      canPlay: true,
      canStop: true,
      canPause: false,
      canResume: false,
      resumeBlocker: "plan_access_denied",
      issue: "plan_access_denied",
      frontierStepIds: [],
    });
  });

  it("refuses when the run belongs to another plan", async () => {
    const { service, mocks } = createPlanContext();
    boundary.controls.read.mockResolvedValue({ canEdit: true, runId: "run-1" });
    mocks.runs.find.mockResolvedValue(planRun({ planId: "other-plan" }));

    await expect(service.control("owner", "plan-1")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("does not hide failures that are no domain refusal", async () => {
    const { service, mocks } = createPlanContext();
    boundary.controls.read.mockResolvedValue({ canEdit: true, runId: "run-1" });
    mocks.runs.find.mockResolvedValue(planRun());
    boundary.readRun.mockRejectedValue(new Error("storage down"));

    await expect(service.control("owner", "plan-1")).rejects.toThrow(
      "storage down",
    );
  });
});

function boundPlan(id: string, projectId: string, agentId: string): AgentPlan {
  return {
    ...planView({ id, name: `Plan ${id}`, projectId }),
    nodes: [
      { id: "ticket", type: "task", x: 0, y: 0, taskId: "task-1" },
      {
        id: "step",
        type: "agent",
        x: 0,
        y: 0,
        agentId,
        personalAgentId: null,
        instruction: "",
        bindings: { ticket: { kind: "source", nodeId: "ticket" } },
      },
    ],
  };
}

describe("AgentPlanService.taskAssignments", () => {
  it("lists per agent the readable tickets bound by plan steps and omits user agents", async () => {
    const { service, mocks } = createPlanContext();
    mocks.plans.list.mockResolvedValue([
      boundPlan("plan-a", "project-1", "agent-1"),
      boundPlan("plan-b", "project-1", "agent-1"),
      boundPlan("plan-c", "project-2", "agent-gone"),
      boundPlan("plan-d", "project-1", "agent-user"),
      planView({ id: "plan-e" }),
    ]);
    mocks.profiles.userAgentIds.mockResolvedValue(new Set(["agent-user"]));
    mocks.tasks.list.mockImplementation(async (_, projectId) =>
      projectId === "project-1"
        ? [
            {
              id: "task-1",
              key: "PAGE-1",
              title: "Synthetic",
              type: "task",
              parentId: null,
              statusKey: "open",
              statusName: "Open",
              isDone: false,
              createdAt: "2026-01-01",
              updatedAt: "2026-01-02",
            },
          ]
        : [],
    );

    const assignments = await service.taskAssignments(ADMIN);

    expect(assignments).toEqual({
      "agent-1": ["plan-a", "plan-b"].map((planId) => ({
        planId,
        planName: `Plan ${planId}`,
        taskId: "task-1",
        key: "PAGE-1",
        title: "Synthetic",
      })),
    });
    // The tickets of a project are read once for all of its plans.
    expect(mocks.tasks.list).toHaveBeenCalledTimes(2);
    expect(mocks.tasks.list).toHaveBeenCalledWith("admin", "project-1");
  });

  it("refuses a person who is not an administrator", async () => {
    const { service, mocks } = createPlanContext();

    await expect(
      service.taskAssignments({ ...ADMIN, isAdmin: false }),
    ).rejects.toThrow("Administrator mode is required");
    expect(mocks.plans.list).not.toHaveBeenCalled();
  });
});
