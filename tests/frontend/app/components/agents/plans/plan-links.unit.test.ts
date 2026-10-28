import { expect, it } from "vitest";

import {
  planLinkKey,
  planLinkLabel,
  planLinks,
  removePlanLink,
} from "@/app/components/agents/plans/plan-links";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import {
  GROUP_SOURCES,
  agentNode,
  flowEdge,
  planOf,
  scriptNode,
  sessionGroup,
} from "./plan-group-fixture";

import type { PlanLink } from "@/app/components/agents/plans/plan-links";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const PORT = {
  id: "port",
  name: "common",
  type: "text" as const,
  description: "",
  isRequired: true,
  defaultValue: null,
};

/**
 * Start → agent → End beside a script, a group with a legacy port and explicit
 * edges, a legacy group without edges and a loop; every container also holds
 * an edge or a binding to a node that no longer exists.
 */
function linkedPlan(): AgentPlanInput {
  const group = sessionGroup({
    id: "group",
    name: "Session",
    parameters: [PORT],
    bindings: { common: { kind: "source", nodeId: "ticket" } },
    steps: [
      agentNode("m1", "codex", {
        bindings: { input1: { kind: "source", nodeId: "port" } },
      }),
      agentNode("m2", "codex", {
        bindings: {
          input1: { kind: "result", stepId: "m1" },
          extra: { kind: "source", nodeId: "ticket" },
        },
      }),
    ],
    edges: [flowEdge("m1", "m2"), flowEdge("m2", "ghost")],
  });
  const legacy = sessionGroup({
    id: "legacy",
    steps: [agentNode("l1", "codex"), agentNode("l2", "codex")],
  });
  const loop: AgentPlanLoop = {
    ...emptyPlanLoop("loop", "Loop", { x: 0, y: 0 }),
    steps: [
      agentNode("lm1", "codex", {
        bindings: { last: { kind: "previous", stepId: "ls" } },
      }),
      scriptNode("ls", 1, { in1: { kind: "result", stepId: "lm1" } }),
    ],
    edges: [flowEdge("lm1", "ls"), flowEdge("lm1", "ghost")],
  };
  return planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      { id: "end", type: "end", x: 0, y: 0 },
      { id: "ticket", type: "task", x: 0, y: 0, taskId: "task-1" },
      agentNode("a1", "codex", {
        bindings: {
          fixed: { kind: "literal", value: null },
          before: { kind: "previous", stepId: "a1" },
          src: { kind: "source", nodeId: "ticket" },
          res: { kind: "result", stepId: "m1" },
          lost: { kind: "source", nodeId: "nowhere" },
        },
      }),
      scriptNode("s1", 1, { in1: { kind: "result", stepId: "a1" } }),
      group,
      legacy,
      loop,
    ],
    [flowEdge("start", "a1"), flowEdge("a1", "end"), flowEdge("a1", "ghost")],
  );
}

function frame<T extends AgentPlanGroup | AgentPlanLoop>(
  plan: AgentPlanInput,
  id: string,
  type: T["type"],
): T {
  const node = plan.nodes.find((entry) => entry.id === id);
  if (node?.type !== type) throw new Error(`Missing ${type} ${id}`);
  return node as T;
}

it("lists the flow edges and bindings whose both ends exist, inside every frame", () => {
  expect(planLinks(linkedPlan())).toEqual([
    { kind: "flow", from: "start", to: "a1" },
    { kind: "flow", from: "a1", to: "end" },
    { kind: "data", from: "ticket", to: "a1", parameter: "src" },
    { kind: "data", from: "m1", to: "a1", parameter: "res" },
    { kind: "data", from: "a1", to: "s1", parameter: "in1" },
    { kind: "data", from: "ticket", to: "group", parameter: "common" },
    { kind: "flow", from: "m1", to: "m2", groupId: "group" },
    {
      kind: "data",
      from: "group",
      to: "m1",
      parameter: "input1",
      port: "port",
    },
    { kind: "data", from: "m1", to: "m2", parameter: "input1" },
    { kind: "data", from: "ticket", to: "m2", parameter: "extra" },
    // A group saved before internal edges runs its members as a chain.
    { kind: "flow", from: "l1", to: "l2", groupId: "legacy" },
    { kind: "flow", from: "lm1", to: "ls", loopId: "loop" },
    { kind: "data", from: "lm1", to: "ls", parameter: "in1" },
  ]);
});

it("keys a flow by its two nodes and a binding by its target parameter", () => {
  expect(planLinkKey({ kind: "flow", from: "a", to: "b" })).toBe("flow:a:b");
  expect(
    planLinkKey({ kind: "data", from: "a", to: "b", parameter: "p" }),
  ).toBe("data:b:p");
});

it("removes exactly one outer, group or loop flow edge", () => {
  const plan = linkedPlan();
  expect(
    removePlanLink(plan, { kind: "flow", from: "start", to: "a1" }).edges,
  ).toEqual([flowEdge("a1", "end"), flowEdge("a1", "ghost")]);
  const ungrouped = removePlanLink(plan, {
    kind: "flow",
    from: "m1",
    to: "m2",
    groupId: "group",
  });
  expect(frame<AgentPlanGroup>(ungrouped, "group", "group").edges).toEqual([
    flowEdge("m2", "ghost"),
  ]);
  const unlooped = removePlanLink(plan, {
    kind: "flow",
    from: "lm1",
    to: "ls",
    loopId: "loop",
  });
  expect(frame<AgentPlanLoop>(unlooped, "loop", "loop").edges).toEqual([
    flowEdge("lm1", "ghost"),
  ]);
});

it("removes one binding and keeps the plan when the target is gone", () => {
  const plan = linkedPlan();
  const unbound = removePlanLink(plan, {
    kind: "data",
    from: "ticket",
    to: "a1",
    parameter: "src",
  });
  const target = unbound.nodes.find((node) => node.id === "a1");
  if (target?.type !== "agent") throw new Error("Missing agent");
  expect(Object.keys(target.bindings)).toEqual([
    "fixed",
    "before",
    "res",
    "lost",
  ]);
  const missing: PlanLink = {
    kind: "data",
    from: "ticket",
    to: "nobody",
    parameter: "src",
  };
  expect(removePlanLink(plan, missing)).toBe(plan);
});

it("names both ends, a group's boundary port and a binding's parameter", () => {
  const plan = linkedPlan();
  const label = (link: PlanLink): string =>
    planLinkLabel(plan, GROUP_SOURCES, link);
  expect(label({ kind: "flow", from: "start", to: "a1" })).toBe(
    "start → Codex One",
  );
  expect(label({ kind: "flow", from: "ghost", to: "m2" })).toBe(
    "ghost → Codex One",
  );
  expect(
    label({ kind: "data", from: "ticket", to: "a1", parameter: "src" }),
  ).toBe("SYN-1: Open work → Codex One · src");
  expect(
    label({
      kind: "data",
      from: "group",
      to: "m1",
      parameter: "input1",
      port: "port",
    }),
  ).toBe("Session · common → Codex One · input1");
  // A port that is not the port of a group adds nothing to the label.
  expect(
    label({
      kind: "data",
      from: "group",
      to: "m1",
      parameter: "input1",
      port: "removed",
    }),
  ).toBe("Session → Codex One · input1");
  expect(
    label({
      kind: "data",
      from: "ticket",
      to: "a1",
      parameter: "src",
      port: "port",
    }),
  ).toBe("SYN-1: Open work → Codex One · src");
});
