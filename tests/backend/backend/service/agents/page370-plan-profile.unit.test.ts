import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanStartActions } from "@/backend/service/agents/AgentPlanStartActions";
import { initialPlanRun } from "@/backend/service/agents/AgentPlanRunStart";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { planProfileProblem } from "@/definition/AgentPlanProfile";
import { readPlanStartRejection } from "@/backend/agents/AgentPlanStartRejectionInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { planOperationFailure } from "@/backend/service/agents/bridge/PlanBridgeFailure";

import { templateFixture } from "./page74-template-fixture";
import { memoryFiles } from "./page-agent-files";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

vi.mock("node:fs/promises", async () =>
  (await import("./page-agent-files")).memoryFilesModule(),
);

beforeEach(() => memoryFiles.reset());

it.each(["profileMissing", "profileInactive"] as const)(
  "retains the %s finding across the plan bridge",
  (problem) => {
    const details = {
      reason: "graph_invalid" as const,
      issues: [{ nodeId: "node", port: null, problem }],
    };
    expect(
      planOperationFailure(new AgentOperationError("INVALID_REQUEST", details))
        ?.details,
    ).toEqual(details);
  },
);

it.each(["missing", "inactive"])(
  "rejects a %s profile before creating a run, including a node with a pinned configuration",
  async (problem) => {
    const { world, agentId, plan, preparation } = await templateFixture();
    const profile = world.stored().find((entry) => entry.id === agentId);
    if (!profile) throw new Error("Missing fixture profile");
    if (problem === "missing") world.withdrawModel(agentId);
    else world.replace({ ...profile, isActive: false });
    const code =
      problem === "missing" ? "agent_usage_denied" : "agent_inactive";
    const start = vi.fn(async (userId: string, snapshot: AgentPlanSnapshot) =>
      initialPlanRun(userId, snapshot),
    );
    const save = vi.fn();
    const append = vi.fn();
    const actions = new AgentPlanStartActions({
      access: {
        require: async () => ({
          ...plan,
          canEdit: true,
          projectName: "Project",
          github: null,
        }),
      },
      preparation,
      engine: { start },
      plans: { save },
      revise: async () => plan,
      startRejections: { append },
    });

    await expect(
      actions.play("owner", plan.id, plan.revision),
    ).rejects.toMatchObject({ code });
    await expect(
      actions.saveAndPlay("owner", plan.id, plan),
    ).rejects.toMatchObject({ code });
    expect(start).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(2);
    const rejection = readPlanStartRejection(append.mock.calls[0]?.[2]);
    expect(rejection.error).toBe(code);
  },
);

it("prepares and starts a valid profile with the same frozen node configuration", async () => {
  const { plan, preparation } = await templateFixture();
  const start = vi.fn(async (userId: string, snapshot: AgentPlanSnapshot) =>
    initialPlanRun(userId, snapshot),
  );
  const actions = new AgentPlanStartActions({
    access: {
      require: async () => ({
        ...plan,
        canEdit: true,
        projectName: "Project",
        github: null,
      }),
    },
    preparation,
    engine: { start },
    plans: { save: vi.fn() },
    revise: async () => plan,
  });
  const run = await actions.play("owner", plan.id, plan.revision);
  expect(start).toHaveBeenCalledOnce();
  expect(run).toMatchObject({ status: "running", planRevision: plan.revision });
  expect(start.mock.calls[0]?.[1].steps[0].step).toEqual(plan.nodes[1]);
});

it("keeps direct connection and runner model nodes independent of profile existence", async () => {
  const { plan, preparation, world, agentId } = await templateFixture();
  const step = plan.nodes.find((node) => node.type === "agent");
  if (!step?.configuration) throw new Error("Missing fixture step");
  const profile = world.stored().find((entry) => entry.id === agentId);
  if (!profile) throw new Error("Missing fixture profile");
  const direct = {
    ...step,
    agentId: "independent-node",
    configuration: {
      ...step.configuration,
      connectionId: profile.connectionId,
    },
  };
  expect(planProfileProblem(direct, [])).toBeNull();
  const remote = {
    ...step,
    configuration: {
      ...step.configuration,
      runnerRoute: {
        connectionId: "runner",
        workspaceId: "remote",
        catalogRevision: "1",
      },
    },
  };
  expect(planProfileProblem(remote, [])).toBeNull();
  const directPlan = {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === step.id ? direct : node)),
  };
  expect(planExecutionIssues(directPlan, [])).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "profileMissing" }),
    ]),
  );
  world.withdrawModel(agentId);
  const snapshot = await preparation.prepare("owner", directPlan);
  expect(snapshot.steps).toHaveLength(1);
});

it("finds a missing profile inside a group as well as on an unconfigured agent", async () => {
  const { plan } = await templateFixture();
  const step = plan.nodes.find((node) => node.type === "agent");
  if (!step) throw new Error("Missing fixture step");
  const grouped: AgentPlan = {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id === step.id
        ? {
            id: "group",
            type: "group",
            name: "Group",
            x: 0,
            y: 0,
            steps: [step],
            parameters: [],
            bindings: {},
            edges: [],
          }
        : node,
    ),
  };
  expect(planExecutionIssues(grouped, [])).toEqual(
    expect.arrayContaining([
      { nodeId: step.id, port: null, reason: "profileMissing" },
    ]),
  );
  expect(planProfileProblem({ ...step, configuration: undefined }, [])).toBe(
    "profileMissing",
  );
});
