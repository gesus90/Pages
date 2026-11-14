import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { ProjectRunsActiveError } from "@/backend/error/ProjectErrors";

import {
  createPlanContext,
  planRun,
  planView,
  stub,
} from "./agent-plan-service-harness";

import type { AgentPlanCloneInput } from "@/backend/service/agents/AgentPlanClone";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const boundary = vi.hoisted(() => ({
  controls: {
    read: vi.fn<() => Promise<Partial<AgentPlanControl>>>(),
    rejectionHistory: vi.fn<() => Promise<object>>(),
  },
  starts: {
    play: vi.fn<() => Promise<AgentPlanRun>>(),
    saveAndPlay: vi.fn<() => Promise<AgentPlanRun>>(),
  },
  cloning: { clone: vi.fn<() => Promise<string>>() },
  readRun: vi.fn<() => Promise<AgentPlanRun>>(),
}));

vi.mock("@/backend/service/agents/AgentPlanControlService", () => ({
  AgentPlanControlService: vi.fn(function () {
    return boundary.controls;
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanStartActions", () => ({
  AgentPlanStartActions: vi.fn(function () {
    return boundary.starts;
  }),
}));
vi.mock("@/backend/service/agents/AgentPlanCloning", () => ({
  AgentPlanCloning: vi.fn(function () {
    return boundary.cloning;
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

describe("AgentPlanService delegations", () => {
  it("clones through the cloning service", async () => {
    const { service } = createPlanContext();
    boundary.cloning.clone.mockResolvedValue("plan-copy");
    const input: AgentPlanCloneInput = { expectedRevision: 1, name: "Copy" };
    const journal = vi.fn(async () => undefined);

    expect(await service.clone("owner", "plan-1", input, journal)).toBe(
      "plan-copy",
    );
    expect(boundary.cloning.clone).toHaveBeenCalledWith(
      "owner",
      "plan-1",
      input,
      journal,
    );
  });

  it("plays and saves-and-plays through the start actions", async () => {
    const { service } = createPlanContext();
    boundary.starts.play.mockResolvedValue(planRun({ id: "played" }));
    boundary.starts.saveAndPlay.mockResolvedValue(planRun({ id: "saved" }));
    const journal = vi.fn(async () => undefined);

    expect((await service.play("owner", "plan-1", 3, journal)).id).toBe(
      "played",
    );
    expect(boundary.starts.play).toHaveBeenCalledWith(
      "owner",
      "plan-1",
      3,
      journal,
    );
    expect((await service.saveAndPlay("owner", "plan-1", { a: 1 })).id).toBe(
      "saved",
    );
    expect(boundary.starts.saveAndPlay).toHaveBeenCalledWith(
      "owner",
      "plan-1",
      { a: 1 },
    );
  });

  it("reads rejections from the control service", async () => {
    const { service } = createPlanContext();
    boundary.controls.rejectionHistory.mockResolvedValue({ entries: [] });

    expect(await service.startRejections("owner", "plan-1", "cursor")).toEqual({
      entries: [],
    });
    expect(boundary.controls.rejectionHistory).toHaveBeenCalledWith(
      "owner",
      "plan-1",
      "cursor",
    );
  });

  it("reads one authorized run", async () => {
    const { service, dependencies } = createPlanContext();

    expect((await service.run("owner", "run-1")).id).toBe("run-1");
    expect(boundary.readRun).toHaveBeenCalledWith(
      dependencies,
      "owner",
      "run-1",
    );
  });

  it("stops the runs of a project and fails when one does not close", async () => {
    const { service, mocks } = createPlanContext();

    await service.stopProject("project-1");
    expect(mocks.engine.stopProject).toHaveBeenCalledWith("project-1");

    mocks.engine.stopProject.mockResolvedValue(false);
    await expect(service.stopProject("project-1")).rejects.toBeInstanceOf(
      ProjectRunsActiveError,
    );
  });

  it("removes record files through the archive when there is one", async () => {
    const removeRecordFiles = vi.fn(async () => undefined);
    const { service } = createPlanContext({
      archive: stub<AgentRunArchive>({ removeRecordFiles }),
    });
    const keys = [{ agentId: "agent-1", runId: "run-1" }];

    await service.removeRunRecordFiles(keys);
    await createPlanContext().service.removeRunRecordFiles(keys);

    expect(removeRecordFiles).toHaveBeenCalledExactlyOnceWith(keys);
  });

  it("completes cancellation in the engine on shutdown", async () => {
    const { service, mocks } = createPlanContext();

    await service.shutdown();

    expect(mocks.engine.shutdown).toHaveBeenCalledOnce();
  });
});

describe("AgentPlanService.remove", () => {
  it("lets the owner delete the plan with the revision and journal", async () => {
    const { service, mocks } = createPlanContext();
    const options = { revision: 2, journal: async () => undefined };

    await service.remove("owner", "plan-1", options);

    expect(mocks.plans.remove).toHaveBeenCalledWith("plan-1", "owner", options);
  });

  it("refuses everyone else, however many people share the plan", async () => {
    const { service, mocks } = createPlanContext();

    await expect(service.remove("member", "plan-1")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
    expect(mocks.plans.remove).not.toHaveBeenCalled();
  });
});

describe("AgentPlanService.controlRun", () => {
  it("authorizes control for the executor who may edit the plan", async () => {
    const { service, mocks } = createPlanContext({
      engine: stub<PlanDependencies["engine"]>({
        commandReceipt: async () => ({ kind: "stop" }),
      }),
    });
    mocks.runs.find.mockResolvedValue(planRun());

    expect(await service.controlRun("owner", "run-1")).toMatchObject({
      id: "run-1",
      command: { kind: "stop" },
    });
  });

  it("refuses control of a missing run", async () => {
    const { service } = createPlanContext();

    await expect(service.controlRun("owner", "run-1")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("refuses control of the private run of someone else", async () => {
    const { service, mocks } = createPlanContext();
    mocks.runs.find.mockResolvedValue(planRun({ userId: "other" }));

    await expect(service.controlRun("owner", "run-1")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("refuses control of a run of a plan the person cannot edit", async () => {
    const { service, mocks } = createPlanContext();
    mocks.runs.find.mockResolvedValue(planRun());
    mocks.access.require.mockResolvedValue(planView({ canEdit: false }));

    await expect(service.controlRun("owner", "run-1")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });
});

describe("AgentPlanService stop and pause", () => {
  it("stops the run in the engine and the remote attempts when the engine keeps no command receipt", async () => {
    const stopRemote = vi.fn(async () => undefined);
    const { service, mocks } = createPlanContext({
      remoteExecution: stub<PlanDependencies["remoteExecution"] & object>({
        stop: stopRemote,
      }),
    });
    const run = planRun({ status: "stopping", stopRequested: true });
    mocks.runs.find.mockResolvedValue(run);
    boundary.readRun.mockResolvedValue(run);
    const journal = vi.fn(async () => undefined);

    const stopped = await service.stop("owner", "run-1", journal);

    expect(mocks.engine.stop).toHaveBeenCalledWith("run-1", journal);
    expect(stopRemote).toHaveBeenCalledWith(run);
    expect(stopped.status).toBe("stopping");
  });

  it("leaves the remote attempts to the engine when it keeps command receipts", async () => {
    const stopRemote = vi.fn(async () => undefined);
    const { service, mocks } = createPlanContext({
      remoteExecution: stub<PlanDependencies["remoteExecution"] & object>({
        stop: stopRemote,
      }),
      engine: stub<PlanDependencies["engine"]>({
        stop: async () => undefined,
        commandReceipt: async () => null,
      }),
    });
    mocks.runs.find.mockResolvedValue(planRun());

    await service.stop("owner", "run-1");

    expect(stopRemote).not.toHaveBeenCalled();
  });

  it("pauses an own run of an editable plan", async () => {
    const { service, mocks } = createPlanContext();
    const journal = vi.fn(async () => undefined);
    mocks.runs.find.mockResolvedValue(planRun());

    await service.pause("owner", "run-1", journal);

    expect(mocks.engine.pause).toHaveBeenCalledWith("run-1", journal);
  });

  it("refuses to pause for a person who cannot edit the plan", async () => {
    const { service, mocks } = createPlanContext();
    mocks.access.require.mockResolvedValue(planView({ canEdit: false }));

    await expect(service.pause("owner", "run-1")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
    expect(mocks.engine.pause).not.toHaveBeenCalled();
  });
});
