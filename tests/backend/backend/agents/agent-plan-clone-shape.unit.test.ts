import { expect, it } from "vitest";

import { requireCloneablePlan } from "@/backend/agents/AgentPlanCloneShape";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { agentErrorCode } from "./agent-error-code";
import { POSITION, agentNode, planInput } from "./agent-plan-input-fixture";

import type { NodeFields } from "./agent-plan-input-fixture";

const TASK = { id: "t1", ...POSITION, type: "task", taskId: "k1" };

function cloneRefusal(input: unknown): string | null {
  try {
    requireCloneablePlan(input);
  } catch (error: unknown) {
    if (!(error instanceof AgentOperationError)) return "other";
    const { details } = error;
    const reason = details && "reason" in details ? details.reason : undefined;
    return `${error.code}:${String(reason)}`;
  }
  return null;
}

const UNSUPPORTED = "INVALID_REQUEST:plan_schema_unsupported";

it("accepts a stored plan whose every field the reader knows", () => {
  expect(
    cloneRefusal({
      ...planInput({
        nodes: [agentNode({ completion: "report" })],
        sharing: {
          isGlobal: true,
          targets: [{ kind: "group", targetId: "g" }],
        },
      }),
      id: "plan",
      ownerId: "owner",
      departmentId: null,
    }),
  ).toBeNull();
});

it.each<[string, NodeFields]>([
  ["an unknown plan field", { color: "red" }],
  ["an unknown node field", { nodes: [agentNode({ color: "red" })] }],
  [
    "a report completion outside an agent",
    { nodes: [{ ...TASK, completion: "report" }] },
  ],
  ["another completion value", { nodes: [{ ...TASK, completion: "todos" }] }],
  [
    "a flow kind outside an edge",
    { nodes: [{ id: "s", ...POSITION, type: "start", kind: "flow" }] },
  ],
  [
    "another kind value",
    { nodes: [{ id: "s", ...POSITION, type: "start", kind: "data" }] },
  ],
  [
    "repeated share targets the reader merges",
    {
      sharing: {
        isGlobal: false,
        targets: [
          { kind: "group", targetId: "g" },
          { kind: "group", targetId: "g" },
        ],
      },
    },
  ],
  [
    "a flow through a ticket node",
    {
      nodes: [agentNode(), TASK],
      edges: [
        { from: "a1", to: "t1" },
        { from: "t1", to: "a1" },
      ],
    },
  ],
])("refuses a stored plan with %s", (scenario, change) => {
  expect(cloneRefusal(planInput(change))).toBe(UNSUPPORTED);
});

it("refuses a stored plan that is no object", () => {
  expect(cloneRefusal([])).toBe(UNSUPPORTED);
});

it("leaves malformed plans to the normal reader", () => {
  expect(
    agentErrorCode(() => requireCloneablePlan(planInput({ nodes: {} }))),
  ).toBe("plan_invalid");
});
