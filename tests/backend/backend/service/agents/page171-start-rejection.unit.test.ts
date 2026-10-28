import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";
import { AgentPlanWorkspaceReservationError } from "@/backend/error/AgentPlanWorkspaceReservationError";
import { readPlanStartRejection } from "@/backend/agents/AgentPlanStartRejectionInput";
import { executePlanStart } from "@/backend/service/agents/AgentPlanStartRejections";
import { AgentPlanStartActions } from "@/backend/service/agents/AgentPlanStartActions";
import { AgentPlanControlService } from "@/backend/service/agents/AgentPlanControlService";
import { workspaceConflict } from "@/backend/service/agents/AgentPlanWorkspaceConflict";

import { recoveryFixture } from "./page84-recovery-fixture";
import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import type { AgentPlanRunJournal } from "@/backend/service/agents/AgentPlanJournal";

const CONFLICT = workspaceConflict("parallel_writers", [
  {
    id: "writer-a",
    name: "Synthetic writer",
    target: {
      kind: "local",
      workspaceId: "workspace-1",
      path: "/synthetic/repository",
      connectionName: null,
      workspaceName: null,
    },
  },
]);

it("records an interpreter refusal during preparation without creating or starting a run", async () => {
  const fixture = await recoveryFixture();
  const error = new AgentError("plan_script_interpreter_unavailable");
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  const start = vi.fn(async () => fixture.initial);

  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => {
        throw error;
      },
      start,
    ),
  ).rejects.toBe(error);
  expect(start).not.toHaveBeenCalled();
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0]?.[2]).toMatchObject({
    error: "plan_script_interpreter_unavailable",
    reservation: "not_requested",
    targetResolution: "unknown",
  });
  const recorded = append.mock.calls[0]?.[2];
  if (!recorded) throw new Error("Expected a recorded refusal");
  expect(readPlanStartRejection(recorded)).toEqual(recorded);
  expect(() =>
    readPlanStartRejection({ ...recorded, error: "unrecognized-private-text" }),
  ).toThrow();
});

it("does not label an error after dispatch as a refusal before run creation", async () => {
  const fixture = await recoveryFixture();
  const error = new AgentError("plan_script_interpreter_unavailable");
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => fixture.snapshot,
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(append).not.toHaveBeenCalled();
});

it("records node and port for graph validation without persisting asset contents", async () => {
  const fixture = await recoveryFixture();
  const error = new AgentPlanValidationError([
    {
      nodeId: "review",
      port: "input",
      reason: "required",
      asset: {
        id: "private-asset",
        name: "private-name",
        cause: "private-cause",
      },
    },
  ]);
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => {
        throw error;
      },
      async () => fixture.initial,
    ),
  ).rejects.toBe(error);
  const recorded = append.mock.calls[0]?.[2];
  expect(recorded).toMatchObject({
    error: "plan_invalid",
    issues: [{ nodeId: "review", port: "input", problem: "required" }],
    issueDetailsFiltered: true,
  });
  expect(JSON.stringify(recorded)).not.toContain("private-");
  if (!recorded) throw new Error("Expected a recorded graph refusal");
  expect(readPlanStartRejection(recorded)).toEqual(recorded);
});

it("marks a historical graph refusal when more than 50 findings were retained", async () => {
  const fixture = await recoveryFixture();
  const error = new AgentPlanValidationError(
    Array.from({ length: 51 }, (_, index) => ({
      nodeId: `node-${index}`,
      port: null,
      reason: "required" as const,
    })),
  );
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => {
        throw error;
      },
      async () => fixture.initial,
    ),
  ).rejects.toBe(error);
  expect(append.mock.calls[0]?.[2].issues).toHaveLength(50);
  expect(append.mock.calls[0]?.[2].issueDetailsFiltered).toBe(true);
});

it("records an authorized graph refusal without starting a run", async () => {
  const fixture = await recoveryFixture();
  const error = new AgentPlanWorkspaceConflictError(CONFLICT);
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  const start = vi.fn(async () => fixture.initial);

  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => {
        throw error;
      },
      start,
    ),
  ).rejects.toBe(error);
  expect(start).not.toHaveBeenCalled();
  expect(append).toHaveBeenCalledTimes(1);
  expect(append.mock.calls[0]?.slice(0, 2)).toEqual(["owner", "plan"]);
  const recorded = append.mock.calls[0]?.[2];
  if (!recorded) throw new Error("Expected a recorded refusal");
  expect(recorded.id).toMatch(/^[a-f0-9-]{36}$/u);
  expect(Date.parse(recorded.createdAt)).not.toBeNaN();
  expect(recorded).toMatchObject({
    action: "play",
    planRevision: 4,
    isSavedRevision: true,
    error: "plan_workspace_conflict",
    conflict: CONFLICT,
    reservation: "not_requested",
    targetResolution: "local_resolved",
  });
});

it("passes the command journal into the same rejection transaction", async () => {
  const fixture = await recoveryFixture();
  const error = new AgentPlanWorkspaceConflictError(CONFLICT);
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  const journal =
    vi.fn<NonNullable<AgentPlanRunJournal["recordStartRejection"]>>();
  await expect(
    executePlanStart(
      { startRejections: { append } },
      {
        userId: "owner",
        planId: "plan",
        planRevision: 4,
        action: "play",
        journal,
      },
      async () => {
        throw error;
      },
      async () => fixture.initial,
    ),
  ).rejects.toBe(error);
  expect(append.mock.calls[0]?.[3]).toBe(journal);
});

it("records both saved and unsaved start refusals through the plan start actions", async () => {
  const fixture = await recoveryFixture();
  const plan = fixture.snapshot.plan;
  const error = new AgentPlanWorkspaceConflictError(CONFLICT);
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  const start = vi.fn<AgentPlanRunEngine["start"]>();
  const save = vi.fn<AgentPlanRepository["save"]>();
  const actions = new AgentPlanStartActions({
    access: {
      require: async () => ({
        ...plan,
        canEdit: true,
        projectName: "Synthetic",
        github: null,
      }),
    },
    preparation: {
      prepare: async () => {
        throw error;
      },
    },
    engine: { start },
    plans: { save },
    startRejections: { append },
    revise: async () => plan,
  });
  await expect(actions.play("owner", plan.id, plan.revision)).rejects.toBe(
    error,
  );
  await expect(actions.saveAndPlay("owner", plan.id, {})).rejects.toBe(error);
  expect(append.mock.calls.map((call) => call[2])).toMatchObject([
    { action: "play", planRevision: plan.revision, isSavedRevision: true },
    {
      action: "save_and_play",
      planRevision: plan.revision + 1,
      isSavedRevision: false,
    },
  ]);
  expect(start).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("records the conflicting requested workspace from the atomic reservation check", async () => {
  const fixture = await recoveryFixture();
  const workspaceId = fixture.snapshot.steps[0].prepared.workspace.id;
  const error = new AgentPlanWorkspaceReservationError(workspaceId);
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();

  await expect(
    executePlanStart(
      { startRejections: { append } },
      {
        userId: "owner",
        planId: "plan",
        planRevision: 5,
        action: "save_and_play",
      },
      async () => fixture.snapshot,
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(append.mock.calls[0]?.[2]).toMatchObject({
    planRevision: 5,
    isSavedRevision: false,
    reservation: "held",
    conflict: { kind: "reserved", targets: [{ workspaceId }] },
  });
  expect(JSON.stringify(append.mock.calls[0]?.[2])).not.toContain("other-run");
});

it("does not invent a reservation when the original error has no details", async () => {
  const fixture = await recoveryFixture();
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>();
  const error = new AgentError("plan_workspace_conflict");
  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => fixture.snapshot,
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(append.mock.calls[0]?.[2]).toMatchObject({
    conflict: null,
    reservation: "unknown",
    targetResolution: "unknown",
  });
});

it("reports when the refusal could not be stored and never starts a run", async () => {
  const fixture = await recoveryFixture();
  const append = vi.fn<AgentPlanStartRejectionRepository["append"]>(
    async () => {
      throw new Error("Synthetic journal unavailable");
    },
  );
  const start = vi.fn(async () => fixture.initial);
  await expect(
    executePlanStart(
      { startRejections: { append } },
      { userId: "owner", planId: "plan", planRevision: 4, action: "play" },
      async () => {
        throw new AgentPlanWorkspaceConflictError(CONFLICT);
      },
      start,
    ),
  ).rejects.toMatchObject({ code: "plan_start_rejection_record_failed" });
  expect(start).not.toHaveBeenCalled();
});

it("shows only the requester's past refusal and hides targets after access is lost", async () => {
  const plan = runnablePlan("plan");
  const world = new PlanWorld();
  const rejection: AgentPlanStartRejection = {
    id: "rejection",
    createdAt: "2026-10-28T12:00:00.000Z",
    action: "play",
    planRevision: 1,
    isSavedRevision: true,
    error: "plan_workspace_conflict",
    conflict: CONFLICT,
    reservation: "not_requested",
    targetResolution: "local_resolved",
  };
  let hasWorkspaceAccess = true;
  const control = new AgentPlanControlService({
    access: {
      require: async () => ({
        ...plan,
        canEdit: true,
        projectName: "Synthetic",
        github: null,
      }),
    },
    profiles: { catalog: async () => world.catalog },
    startRejections: {
      latest: async (userId) => (userId === "owner" ? rejection : null),
    },
    workspaceCatalog: {
      requireAccess: async () => {
        if (!hasWorkspaceAccess) throw new AgentError("plan_access_denied");
      },
    },
    runs: {
      latest: async () => null,
      hasReservation: async () => false,
      findWorkspaceReservation: async () => null,
      resources: async () => ({
        projectId: plan.projectId,
        workspaceIds: [plan.workspaceId],
        taskIds: [],
        wikiIds: [],
        ticketIds: [],
        agentIds: [],
      }),
    },
  });
  const own = await control.read("owner", plan.id);
  expect(own.lastStartRejection).toEqual(rejection);
  expect(own.runId).toBeNull();
  expect(own.canPlay).toBe(true);
  expect(
    (await control.read("other", plan.id)).lastStartRejection,
  ).toBeUndefined();
  hasWorkspaceAccess = false;
  const redacted = await control.read("owner", plan.id);
  expect(redacted.lastStartRejection).toMatchObject({
    conflict: null,
    targetResolution: "unknown",
  });
  expect(JSON.stringify(redacted.lastStartRejection)).not.toContain(
    "/synthetic/repository",
  );
});
