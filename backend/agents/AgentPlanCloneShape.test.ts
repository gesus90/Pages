import { describe, expect, it } from "vitest";

import { requireCloneablePlan } from "@/backend/agents/AgentPlanCloneShape";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

const PLAN = {
  id: "p",
  ownerId: "o",
  departmentId: "d",
  name: "Plan",
  workspaceId: "w",
  usage: "private",
  globals: {},
  nodes: [
    {
      id: "a",
      type: "agent",
      x: 0,
      y: 0,
      agentId: "agent",
      personalAgentId: null,
      instruction: "Do",
      completion: "report",
      bindings: {},
    },
    { id: "t", type: "task", x: 0, y: 0, taskId: "task" },
    { id: "b", type: "variable", x: 10, y: 0, name: "v" },
  ],
  edges: [{ from: "a", to: "b", kind: "flow" }],
};

function refused(input: unknown): boolean {
  try {
    requireCloneablePlan(input);
  } catch (error) {
    return error instanceof AgentOperationError;
  }
  return false;
}

describe("requireCloneablePlan", () => {
  it("accepts a plan the reader keeps completely", () => {
    expect(() => requireCloneablePlan(PLAN)).not.toThrow();
  });

  it("refuses a value that is not an object", () => {
    expect(refused(null)).toBe(true);
    expect(refused([PLAN])).toBe(true);
    expect(refused("plan")).toBe(true);
  });

  it("refuses unknown structure the reader would discard", () => {
    expect(refused({ ...PLAN, unknown: 1 })).toBe(true);
    expect(
      refused({
        ...PLAN,
        nodes: [{ ...PLAN.nodes[0], unknownField: 1 }, ...PLAN.nodes.slice(1)],
      }),
    ).toBe(true);
  });

  it("refuses a list the reader shortens", () => {
    const target = { kind: "group", targetId: "g" };
    expect(
      refused({
        ...PLAN,
        sharing: { isGlobal: false, operator: "or", targets: [target, target] },
      }),
    ).toBe(true);
    expect(
      refused({
        ...PLAN,
        sharing: { isGlobal: false, operator: "or", targets: [target] },
      }),
    ).toBe(false);
  });

  it("refuses an edge that only a ticket node connects", () => {
    expect(
      refused({
        ...PLAN,
        edges: [
          { from: "a", to: "t" },
          { from: "t", to: "b" },
        ],
      }),
    ).toBe(true);
  });
});
