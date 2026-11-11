import { describe, expect, it } from "vitest";

import { clonePlanGraph } from "@/backend/service/agents/AgentPlanClone";

import type { AgentPlanInput, AgentPlanStep } from "@/definition/AgentPlan";

const step: AgentPlanStep = {
  id: "step",
  type: "agent",
  x: 0,
  y: 0,
  agentId: "agent",
  personalAgentId: null,
  instruction: "Review",
  bindings: {
    source: { kind: "source", nodeId: "start" },
    result: { kind: "result", stepId: "step" },
    previous: { kind: "previous", stepId: "step" },
    literal: { kind: "literal", value: null },
  },
};
const plan: AgentPlanInput = {
  name: "Original",
  workspaceId: "workspace",
  usage: "workspace",
  globals: { key: "value" },
  executionTarget: { kind: "remote", workspaceId: "remote" },
  nodes: [{ id: "start", type: "start", x: 0, y: 0 }, step],
  edges: [{ from: "start", to: "step", fromPort: "out", toPort: "in" }],
};

describe("cloning plan graphs", () => {
  it("remaps identities, edges and bindings while preserving the source", () => {
    const copy = clonePlanGraph(plan, { name: "Copy", expectedRevision: 1 });
    const start = copy.nodes[0];
    const clonedStep = copy.nodes[1];
    expect(start?.id).not.toBe("start");
    expect(clonedStep?.type).toBe("agent");
    if (!start || !clonedStep || clonedStep.type !== "agent")
      throw new Error("Missing cloned nodes");
    expect(clonedStep.id).not.toBe("step");
    expect(clonedStep.agentId).toBe("agent");
    expect(clonedStep.bindings).toEqual({
      source: { kind: "source", nodeId: start.id },
      result: { kind: "result", stepId: clonedStep.id },
      previous: { kind: "previous", stepId: clonedStep.id },
      literal: { kind: "literal", value: null },
    });
    expect(copy.edges[0]).toEqual({
      from: start.id,
      to: clonedStep.id,
      fromPort: "out",
      toPort: "in",
    });
    expect(copy).toMatchObject({
      name: "Copy",
      workspaceId: "workspace",
      usage: "private",
      sharing: { isGlobal: false, targets: [], operator: "or" },
      executionTarget: plan.executionTarget,
    });
    expect(plan.nodes[1]).toEqual(step);
  });

  it("uses an explicit workspace and local target", () => {
    const copy = clonePlanGraph(plan, {
      name: "Copy",
      expectedRevision: 1,
      workspaceId: "other",
      executionTarget: { kind: "local" },
    });
    expect(copy.workspaceId).toBe("other");
    expect(copy.executionTarget).toBeUndefined();
  });

  it("refuses duplicate identities and dangling references", () => {
    expect(() =>
      clonePlanGraph(
        { ...plan, nodes: [step, step] },
        { name: "Copy", expectedRevision: 1 },
      ),
    ).toThrow();
    expect(() =>
      clonePlanGraph(
        {
          ...plan,
          edges: [
            { from: "missing", to: "step", fromPort: "out", toPort: "in" },
          ],
        },
        { name: "Copy", expectedRevision: 1 },
      ),
    ).toThrow();
    expect(() =>
      clonePlanGraph(
        { ...plan, nodes: [step] },
        { name: "Copy", expectedRevision: 1 },
      ),
    ).toThrow();
  });
});
