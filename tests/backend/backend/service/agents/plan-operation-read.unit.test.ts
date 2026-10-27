import { beforeEach, expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  PlanWorld,
  REVIEWER,
  runnablePlan,
  WORKSPACE,
} from "./plan-operation-world";

import type {
  AgentPlanList,
  AgentPlanRead,
  AgentPlanSourceList,
} from "@/definition/AgentPlanOperations";

let world: PlanWorld;

async function refusal(
  promise: Promise<unknown>,
): Promise<AgentOperationError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AgentOperationError) return error;
    throw error;
  }
  throw new Error("The call was not refused.");
}

function startedAt(minute: number): string {
  return `2026-10-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

beforeEach(() => {
  world = new PlanWorld();
  world.seed(runnablePlan("plan-a", { name: "Alpha review" }));
  world.seed(runnablePlan("plan-b", { name: "Beta build" }));
  world.seed({
    ...runnablePlan("plan-private", {
      name: "Alpha private",
      ownerId: "reader",
    }),
    usage: "private",
  });
});

it("lists only plans the person may read, by name, with state and latest run", async () => {
  world.addRun({ id: "run-1", planId: "plan-a", startedAt: startedAt(1) });
  world.addRun({
    id: "run-2",
    planId: "plan-a",
    startedAt: startedAt(2),
    status: "running",
  });

  const owner = (await world.call("owner", "plans.list")) as AgentPlanList;
  const reader = (await world.call("reader", "plans.list")) as AgentPlanList;
  const outsider = (await world.call(
    "outsider",
    "plans.list",
  )) as AgentPlanList;

  expect(owner.plans.map((plan) => plan.name)).toEqual([
    "Alpha review",
    "Beta build",
  ]);
  expect(owner.plans[0]).toMatchObject({
    id: "plan-a",
    canEdit: true,
    revision: 1,
    state: "running",
    latestRun: { runId: "run-2", planId: "plan-a", status: "running" },
    sharing: { scope: "global" },
  });
  expect(reader.plans.map((plan) => [plan.name, plan.canEdit])).toEqual([
    ["Alpha private", true],
    ["Alpha review", false],
    ["Beta build", false],
  ]);
  // The reader started no run, so the owner's runs do not show for them.
  expect(reader.plans[1]).toMatchObject({ state: "idle", latestRun: null });
  expect(outsider).toEqual({ plans: [], total: 0, nextCursor: null });
});

it("finds plans by a part of their name and pages through them", async () => {
  const found = (await world.call("reader", "plans.list", {
    text: "alpha",
    limit: 1,
  })) as AgentPlanList;
  const next = (await world.call("reader", "plans.list", {
    text: "alpha",
    limit: 1,
    cursor: found.nextCursor,
  })) as AgentPlanList;

  expect(found.total).toBe(2);
  expect(found.plans.map((plan) => plan.name)).toEqual(["Alpha private"]);
  expect(next.plans.map((plan) => plan.name)).toEqual(["Alpha review"]);
  expect(next.nextCursor).toBeNull();
});

it("keeps the name filter within the 120 characters list_plans offers", async () => {
  const longest = (await world.call("reader", "plans.list", {
    text: "a".repeat(120),
  })) as AgentPlanList;
  const refused = await refusal(
    world.call("reader", "plans.list", { text: "a".repeat(121) }),
  );

  expect(longest).toEqual({ plans: [], total: 0, nextCursor: null });
  expect(refused.code).toBe("INVALID_REQUEST");
});

it("reads one plan with labelled nodes, flow edges and the Play check", async () => {
  world.addRun({ id: "run-1", planId: "plan-a", startedAt: startedAt(1) });

  const { plan } = (await world.call("owner", "plans.read", {
    planId: "plan-a",
  })) as AgentPlanRead;

  expect(plan.nodes.map((node) => [node.id, node.type, node.label])).toEqual([
    ["start", "start", "Start"],
    ["review", "agent", "Reviewer"],
    ["end", "end", "End"],
    ["ticket", "task", "PAGE-1 · Synthetic ticket"],
    ["directory", "parameter", "repository"],
  ]);
  expect(plan.nodes[1]).toMatchObject({
    agentId: REVIEWER,
    bindings: { ticket: { kind: "source", nodeId: "ticket" } },
  });
  expect(plan.edges).toEqual([
    {
      from: "start",
      to: "review",
      fromPort: "flow-out",
      toPort: "flow-in",
    },
    {
      from: "review",
      to: "end",
      fromPort: "flow-out",
      toPort: "flow-in",
    },
  ]);
  expect(plan.status).toMatchObject({
    state: "idle",
    runCount: 1,
    latestRun: { runId: "run-1", startedAt: startedAt(1) },
    isRunnable: true,
    issues: [],
  });
});

it("reports why a plan cannot run", async () => {
  world.seed({
    ...runnablePlan("plan-open"),
    edges: [
      {
        from: "start",
        to: "review",
        fromPort: "flow-out",
        toPort: "flow-in",
      },
    ],
  });

  const { plan } = (await world.call("owner", "plans.read", {
    planId: "plan-open",
  })) as AgentPlanRead;

  expect(plan.status.isRunnable).toBe(false);
  expect(plan.status.issues).toContainEqual({
    nodeId: "review",
    port: "flow-out",
    problem: "flowOut",
  });
});

it("answers a hidden plan like a missing one", async () => {
  const hidden = await refusal(
    world.call("owner", "plans.read", { planId: "plan-private" }),
  );
  const missing = await refusal(
    world.call("owner", "plans.read", { planId: "plan-none" }),
  );

  expect(hidden.code).toBe("NOT_FOUND");
  expect(missing.code).toBe("NOT_FOUND");
});

it("lists workspaces and the agents of one with their inputs", async () => {
  const sources = (await world.call("owner", "plans.sources.read", {
    workspaceId: WORKSPACE,
  })) as AgentPlanSourceList;
  const none = (await world.call(
    "outsider",
    "plans.sources.read",
  )) as AgentPlanSourceList;

  expect(sources.workspaces).toEqual([
    {
      id: WORKSPACE,
      name: "Repository",
      projectId: "project-1",
      projectName: "Project One",
      isUsable: true,
    },
  ]);
  expect(sources.agents[0]).toMatchObject({
    id: REVIEWER,
    directoryParameter: "repository",
    parameters: [
      { name: "repository", type: "workspace", isRequired: true },
      { name: "notes", type: "text", isRequired: false },
      { name: "ticket", type: "ticket", isRequired: false },
    ],
  });
  // A person without any workspace sees no source, but still the limits of a plan.
  expect(none).toMatchObject({
    workspaces: [],
    agents: [],
    models: [],
    remoteTargets: [],
    limits: { nodes: 500, edges: 500, changes: 200 },
  });
  expect(
    (
      await refusal(
        world.call("outsider", "plans.sources.read", {
          workspaceId: WORKSPACE,
        }),
      )
    ).code,
  ).toBe("NOT_FOUND");
});
