import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import {
  WORKSPACE,
  WORKSPACE_ID,
  createPlanContext,
  planRun,
  planView,
  stub,
} from "./agent-plan-service-harness";

import type { AgentPlanRun, AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanSelection } from "@/backend/service/agents/AgentPlanPage";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";

const boundary = vi.hoisted(() => ({
  recover:
    vi.fn<(dependencies: object, retained: ReadonlySet<string>) => void>(),
  readPage: vi.fn<(readers: { readonly service: object }) => object>(),
  readContext: vi.fn<(readers: { readonly service: object }) => object>(),
  readSources: vi.fn<(dependencies: object, ...rest: unknown[]) => object>(),
  readRun: vi.fn<() => Promise<AgentPlanRun>>(),
  references: vi.fn<(dependencies: object) => void>(),
}));

vi.mock("@/backend/service/agents/recovery/AgentPlanStartupRecovery", () => ({
  recoverPlanStartup: boundary.recover,
}));
vi.mock("@/backend/service/agents/AgentPlanPage", () => ({
  readPlanPage: boundary.readPage,
  readPlanContext: boundary.readContext,
}));
vi.mock("@/backend/service/agents/AgentPlanSources", () => ({
  readPlanSources: boundary.readSources,
}));
vi.mock("@/backend/service/agents/AgentPlanReferences", () => ({
  validatePlanReferences: boundary.references,
}));
vi.mock("@/backend/service/agents/AgentPlanRunReader", async (original) => ({
  ...(await original<object>()),
  readAuthorizedPlanRun: boundary.readRun,
}));

const NODES: readonly AgentPlanNode[] = [
  { id: "start", type: "start", x: 0, y: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  boundary.readRun.mockImplementation(async () => planRun());
});

describe("AgentPlanService startup and prompts", () => {
  it("hands the retained sessions to startup recovery", async () => {
    const { service, dependencies } = createPlanContext();
    const retained = new Set(["session-1"]);

    await service.recoverInterruptedRuns(retained);
    await service.recoverInterruptedRuns();

    expect(boundary.recover).toHaveBeenNthCalledWith(1, dependencies, retained);
    expect(boundary.recover).toHaveBeenNthCalledWith(
      2,
      dependencies,
      new Set(),
    );
  });

  it("returns the prompt the archive kept for the agent of the node", async () => {
    const sentPrompt = vi.fn(async () => "Review the ticket.");
    const { service, mocks } = createPlanContext({
      archive: stub<AgentRunArchive>({ sentPrompt }),
    });
    mocks.runs.stepAgent.mockResolvedValue("agent-1");

    expect(await service.prompt("owner", "run-1", "review")).toBe(
      "Review the ticket.",
    );
    expect(sentPrompt).toHaveBeenCalledWith("owner", {
      planRunId: "run-1",
      stepId: "review",
      agentId: "agent-1",
    });
  });

  it("refuses the prompt of a node that has no agent", async () => {
    const sentPrompt = vi.fn(async () => "never");
    const { service } = createPlanContext({
      archive: stub<AgentRunArchive>({ sentPrompt }),
    });

    await expect(service.prompt("owner", "run-1", "review")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
    expect(sentPrompt).not.toHaveBeenCalled();
  });

  it("refuses the prompt when no archive is configured", async () => {
    const { service, mocks } = createPlanContext();
    mocks.runs.stepAgent.mockResolvedValue("agent-1");

    await expect(service.prompt("owner", "run-1", "review")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("refuses the prompt when the archive holds none", async () => {
    const { service, mocks } = createPlanContext({
      archive: stub<AgentRunArchive>({ sentPrompt: async () => null }),
    });
    mocks.runs.stepAgent.mockResolvedValue("agent-1");

    await expect(service.prompt("owner", "run-1", "review")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });
});

describe("AgentPlanService page, sources and agents", () => {
  it("loads the page and the context through the page readers", async () => {
    const { service } = createPlanContext();
    boundary.readPage.mockReturnValue({ kind: "page" });
    boundary.readContext.mockReturnValue({ kind: "context" });
    const selection: PlanSelection = { planId: "plan-1", workspaceId: null };

    expect(await service.page("owner", selection)).toEqual({ kind: "page" });
    expect(await service.context("owner", selection)).toEqual({
      kind: "context",
    });
    expect(boundary.readPage.mock.calls[0]?.[0].service).toBe(service);
    expect(boundary.readContext.mock.calls[0]?.[0].service).toBe(service);
  });

  it("reads the sources of a workspace of the person and hides other workspaces", async () => {
    const { service, mocks } = createPlanContext();
    mocks.workspaces.choices.mockResolvedValue([WORKSPACE]);
    boundary.readSources.mockReturnValue({ agents: [], tasks: [] });

    expect(await service.sources("owner", WORKSPACE_ID)).toEqual({
      agents: [],
      tasks: [],
    });
    expect(boundary.readSources.mock.calls[0]?.[0]).toHaveProperty("scripts");
    expect(boundary.readSources.mock.calls[0]?.slice(1)).toEqual([
      "owner",
      WORKSPACE,
    ]);
    await expect(service.sources("owner", "foreign")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("offers the agents of the project of the workspace", async () => {
    const { service, mocks } = createPlanContext();
    mocks.workspaces.choices.mockResolvedValue([WORKSPACE]);

    expect(await service.agents("owner", WORKSPACE_ID)).toHaveLength(1);
    expect(mocks.profiles.catalog).toHaveBeenCalledWith("owner", "project-1");
    await expect(service.agents("owner", "foreign")).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
  });

  it("prefers the workspace catalog for the workspace choices", async () => {
    const choices = vi.fn(async () => [WORKSPACE]);
    const { service, mocks } = createPlanContext({
      workspaceCatalog: stub<PlanDependencies["workspaceCatalog"] & object>({
        choices,
      }),
    });

    expect(await service.workspaces("owner")).toEqual([WORKSPACE]);
    expect(mocks.workspaces.choices).not.toHaveBeenCalled();
  });

  it("falls back to the workspace service for the workspace choices", async () => {
    const { service, mocks } = createPlanContext();
    mocks.workspaces.choices.mockResolvedValue([WORKSPACE]);

    expect(await service.workspaces("owner")).toEqual([WORKSPACE]);
  });
});

describe("AgentPlanService plan lists", () => {
  it("answers team, visible plans, summaries, one view and the directory from plan access", async () => {
    const { service, mocks } = createPlanContext();
    const team = { projectId: "p", departmentIds: ["d"], departmentId: "d" };
    mocks.access.team.mockResolvedValue(team);
    mocks.access.list.mockResolvedValue([planView()]);
    mocks.access.summaries.mockResolvedValue([
      {
        id: "plan-1",
        name: "Plan",
        ownerId: "owner",
        projectId: "project-1",
        projectName: "Project",
        workspaceId: WORKSPACE_ID,
        usage: "private",
        revision: 1,
        canEdit: true,
      },
    ]);

    expect(await service.team("owner", WORKSPACE_ID)).toBe(team);
    expect(mocks.access.team).toHaveBeenCalledWith("owner", WORKSPACE_ID);
    expect(await service.visible("owner")).toHaveLength(1);
    expect(await service.summaries("owner")).toHaveLength(1);
    expect((await service.view("owner", "plan-1")).id).toBe("plan-1");
    expect(mocks.access.require).toHaveBeenCalledWith("owner", "plan-1");
    expect(await service.directory("owner")).toEqual({
      persons: [],
      departments: [],
      groups: [],
    });
  });

  it("lists the runs of a plan only after the plan is readable", async () => {
    const { service, mocks } = createPlanContext();
    mocks.runs.entries.mockResolvedValue([
      { id: "run-1", startedAt: "t", status: "succeeded" },
    ]);

    expect(await service.runEntries("owner", "plan-1", "oldest")).toHaveLength(
      1,
    );
    expect(mocks.runs.entries).toHaveBeenCalledWith(
      "owner",
      "plan-1",
      "oldest",
    );

    mocks.access.require.mockRejectedValue(
      new AgentError("plan_access_denied"),
    );
    await expect(
      service.runEntries("owner", "plan-2", "newest"),
    ).rejects.toThrow(new AgentError("plan_access_denied"));
  });

  it("leaves plans the person cannot read out of the run overview", async () => {
    const { service, mocks } = createPlanContext();
    mocks.access.list.mockResolvedValue([planView({ id: "plan-1" })]);
    mocks.runs.entries.mockResolvedValue([
      { id: "run-1", startedAt: "t", status: "succeeded" },
    ]);

    const overview = await service.runOverview("owner", ["plan-1", "hidden"]);

    expect([...overview.keys()]).toEqual(["plan-1"]);
    expect(mocks.runs.entries).toHaveBeenCalledExactlyOnceWith(
      "owner",
      "plan-1",
      "newest",
    );
  });

  it("serves another surface from the same storage with that surface's access", async () => {
    const { service, mocks } = createPlanContext();
    const channelAccess = {
      list: vi.fn(async () => [planView({ id: "mcp-plan" })]),
    };
    mocks.access.forChannel.mockReturnValue(channelAccess);

    const other = service.forChannel("mcp");

    expect(other).not.toBe(service);
    expect(await other.visible("owner")).toEqual([
      expect.objectContaining({ id: "mcp-plan" }),
    ]);
    expect(mocks.access.forChannel).toHaveBeenCalledWith("mcp");
    expect(mocks.workspaces.forChannel).toHaveBeenCalledWith("mcp");
  });
});

describe("AgentPlanService.checkNodes", () => {
  it("checks the nodes in the workspace without storing anything", async () => {
    const validate = vi.fn(async () => undefined);
    const { service, mocks, dependencies } = createPlanContext({
      remoteTargets: stub<PlanDependencies["remoteTargets"] & object>({
        validate,
      }),
    });
    mocks.workspaces.choices.mockResolvedValue([WORKSPACE]);

    await service.checkNodes("owner", WORKSPACE_ID, NODES);

    expect(mocks.workspaces.resolve).toHaveBeenCalledWith(
      "owner",
      WORKSPACE_ID,
    );
    expect(validate).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ projectId: "project-1", nodes: NODES }),
    );
    expect(boundary.references).toHaveBeenCalledWith(
      dependencies,
      "owner",
      expect.objectContaining({ nodes: NODES }),
      "project-1",
    );
    expect(mocks.plans.save).not.toHaveBeenCalled();
  });

  it("targets the remote workspace and resolves it through the workspace catalog", async () => {
    const resolve = vi.fn(async () => ({ projectId: "project-9" }));
    const { service, mocks } = createPlanContext({
      workspaceCatalog: stub<PlanDependencies["workspaceCatalog"] & object>({
        choices: async () => [{ ...WORKSPACE, kind: "remote" }],
        resolve,
      }),
    });

    await service.checkNodes("owner", WORKSPACE_ID, NODES);

    expect(resolve).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({
        executionTarget: { kind: "remote", workspaceId: WORKSPACE_ID },
      }),
    );
    expect(mocks.workspaces.resolve).not.toHaveBeenCalled();
    expect(boundary.references).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      expect.anything(),
      "project-9",
    );
  });

  it("refuses a workspace the person cannot use", async () => {
    const { service } = createPlanContext();

    await expect(service.checkNodes("owner", "foreign", NODES)).rejects.toThrow(
      new AgentError("plan_access_denied"),
    );
    expect(boundary.references).not.toHaveBeenCalled();
  });
});
