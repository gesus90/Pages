import { expect, it } from "vitest";

import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";

function framedPlan(type: "group" | "loop"): AgentPlan {
  const original = runnablePlan("frame-plan");
  const review = original.nodes.find(
    (node): node is AgentPlanStep =>
      node.id === "review" && node.type === "agent",
  );
  if (!review) throw new Error("Synthetic review node missing");
  const frame =
    type === "group"
      ? {
          id: "frame",
          type: "group" as const,
          name: "Frame",
          x: 100,
          y: 100,
          steps: [review],
          parameters: [],
          bindings: {},
        }
      : {
          ...emptyPlanLoop("frame", "Frame", { x: 100, y: 100 }),
          steps: [review],
        };
  return {
    ...original,
    nodes: [...original.nodes.filter((node) => node.id !== "review"), frame],
    edges: original.edges.map((edge) => ({
      ...edge,
      from: edge.from === "review" ? "frame" : edge.from,
      to: edge.to === "review" ? "frame" : edge.to,
    })),
  };
}

it.each(["group", "loop"] as const)(
  "refuses to dissolve a connected %s without replacing its edges",
  async (type) => {
    const world = new PlanWorld();
    const original = framedPlan(type);
    world.seed(original);
    await expect(
      world.call("owner", "plans.update", {
        operationId: `dissolve-${type}`,
        planId: original.id,
        expectedRevision: original.revision,
        changes: [
          { action: "updateNode", nodeId: "end", fields: { x: 999 } },
          {
            action: "ungroup",
            nodeId: "frame",
            positions: [{ nodeId: "review", x: 210, y: 320 }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      details: { reason: "plan_frame_repair_required" },
    });
    expect(world.plans.get(original.id)).toEqual(original);
    expect(world.saves).toBe(0);
  },
);

it("refuses a loop membership move that would drop edges", async () => {
  const world = new PlanWorld();
  const original = runnablePlan("frame-plan");
  const plan = {
    ...original,
    nodes: [
      ...original.nodes,
      emptyPlanLoop("frame", "Frame", { x: 500, y: 100 }),
    ],
  };
  world.seed(plan);
  await expect(
    world.call("owner", "plans.update", {
      operationId: "move-connected",
      planId: plan.id,
      expectedRevision: plan.revision,
      changes: [
        {
          action: "placeLoopNode",
          nodeId: "review",
          loopId: "frame",
          x: 110,
          y: 120,
        },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_frame_repair_required" },
  });
  expect(world.plans.get(plan.id)).toEqual(plan);
  expect(world.saves).toBe(0);
});

it("refuses to dissolve a loop while a member retains a previous-iteration input", async () => {
  const world = new PlanWorld();
  const original = framedPlan("loop");
  const plan: AgentPlan = {
    ...original,
    edges: [],
    nodes: original.nodes.map((node) =>
      node.type === "loop"
        ? {
            ...node,
            steps: node.steps.map((step) => ({
              ...step,
              bindings: {
                ...step.bindings,
                notes: { kind: "previous", stepId: "review" },
              },
            })),
          }
        : node,
    ),
  };
  world.seed(plan);
  await expect(
    world.call("owner", "plans.update", {
      operationId: "previous-input",
      planId: plan.id,
      expectedRevision: plan.revision,
      changes: [
        {
          action: "ungroup",
          nodeId: "frame",
          positions: [{ nodeId: "review", x: 210, y: 320 }],
        },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_frame_repair_required" },
  });
  expect(world.plans.get(plan.id)).toEqual(plan);
  expect(world.saves).toBe(0);
});

it("dissolves a repaired frame without replacing connections or changing its member", async () => {
  const world = new PlanWorld();
  const original = framedPlan("loop");
  const plan = { ...original, edges: [] };
  world.seed(plan);
  await expect(
    world.call("owner", "plans.update", {
      operationId: "dissolve-repaired",
      planId: plan.id,
      expectedRevision: plan.revision,
      changes: [
        {
          action: "ungroup",
          nodeId: "frame",
          positions: [{ nodeId: "review", x: 210, y: 320 }],
        },
      ],
    }),
  ).resolves.toMatchObject({ changed: true, revision: 2 });
  const saved = world.plans.get(plan.id);
  expect(saved?.edges).toEqual([]);
  expect(saved?.nodes.find((node) => node.id === "frame")).toBeUndefined();
  expect(saved?.nodes.find((node) => node.id === "review")).toMatchObject({
    x: 210,
    y: 320,
    bindings: {
      repository: { kind: "source", nodeId: "directory" },
      ticket: { kind: "source", nodeId: "ticket" },
    },
  });
});

it("refuses to move the node named by a loop condition", async () => {
  const world = new PlanWorld();
  const original = framedPlan("loop");
  const plan: AgentPlan = {
    ...original,
    edges: [],
    nodes: original.nodes.map((node) =>
      node.type === "loop"
        ? {
            ...node,
            condition: {
              isEnabled: true,
              sourceNodeId: "review",
              outputPath: "$.done",
              operator: "equals",
              expected: { type: "boolean", value: true },
            },
          }
        : node,
    ),
  };
  world.seed(plan);
  await expect(
    world.call("owner", "plans.update", {
      operationId: "condition-source",
      planId: plan.id,
      expectedRevision: plan.revision,
      changes: [
        {
          action: "placeLoopNode",
          nodeId: "review",
          loopId: null,
          x: 210,
          y: 320,
        },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_frame_repair_required" },
  });
  expect(world.plans.get(plan.id)).toEqual(plan);
});
