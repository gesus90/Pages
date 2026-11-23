import { expect, it, vi, type Mock } from "vitest";

import { mapPlanSteps } from "@/definition/AgentPlanGroup";

import { AgentProfileRemoval } from "./AgentProfileRemoval";

import type * as PlanGroup from "@/definition/AgentPlanGroup";
import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

vi.mock("@/definition/AgentPlanGroup", async (importOriginal) => ({
  ...(await importOriginal<typeof PlanGroup>()),
  mapPlanSteps: vi.fn((await importOriginal<typeof PlanGroup>()).mapPlanSteps),
}));

function transactionOf(answers: DatabaseValue[][][]): {
  readonly transaction: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => answers.shift() ?? [],
  );
  return { transaction: { execute, query }, execute };
}

function nodeOf(fields: Record<string, unknown>): Record<string, unknown> {
  return { id: "n", x: 1, y: 2, ...fields };
}

function agentNode(
  id: string,
  agentId: string,
  personalAgentId: string | null,
): Record<string, unknown> {
  return nodeOf({
    id,
    type: "agent",
    agentId,
    personalAgentId,
    instruction: "do",
    bindings: {},
  });
}

function planJson(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({
    name: "Plan",
    workspaceId: "w1",
    usage: "private",
    globals: {},
    nodes,
    edges: [],
  });
}

it("refuses to remove an unknown profile", async () => {
  const { transaction, execute } = transactionOf([[]]);
  await expect(
    new AgentProfileRemoval(transaction).remove("p1"),
  ).rejects.toMatchObject({ code: "profile_not_found" });
  expect(execute).not.toHaveBeenCalled();
});

it("refuses to remove the agent of a user", async () => {
  const { transaction, execute } = transactionOf([[["u1"]]]);
  await expect(
    new AgentProfileRemoval(transaction).remove("p1"),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  expect(execute).not.toHaveBeenCalled();
});

it("clears references and deletes the profile", async () => {
  const { transaction, execute } = transactionOf([[[null]], []]);
  await new AgentProfileRemoval(transaction).remove("p1");
  expect(execute).toHaveBeenCalledTimes(5);
  expect(execute.mock.calls.map((call) => call[1])).toEqual(
    Array(5).fill({ id: "p1" }),
  );
  expect(execute.mock.calls[4]?.[0]).toContain(
    "DELETE FROM agent_execution_profiles",
  );
});

it("empties the references of the profile in plan steps only", async () => {
  const plan = planJson([
    agentNode("a", "p1", null),
    agentNode("b", "other", "p1"),
    agentNode("c", "other", null),
    nodeOf({
      id: "g",
      type: "group",
      name: "g",
      steps: [agentNode("e", "p1", "p1")],
      parameters: [],
      bindings: {},
    }),
  ]);
  const { transaction, execute } = transactionOf([
    [[null]],
    [["plan-1", plan]],
  ]);
  await new AgentProfileRemoval(transaction).remove("p1");
  const update = execute.mock.calls[0];
  expect(update?.[1]).toMatchObject({ id: "plan-1" });
  const stored: unknown = JSON.parse(String(update?.[1]?.plan_json));
  expect(stored).toMatchObject({
    nodes: [
      { id: "a", agentId: "", personalAgentId: null },
      { id: "b", agentId: "other", personalAgentId: "" },
      { id: "c", agentId: "other", personalAgentId: null },
      {
        id: "g",
        steps: [{ id: "e", agentId: "", personalAgentId: "" }],
      },
    ],
  });
  expect(execute).toHaveBeenCalledTimes(6);
});

it("leaves a step that is not an agent step unchanged", async () => {
  const { transaction, execute } = transactionOf([
    [[null]],
    [["plan-1", planJson([agentNode("a", "p1", null)])]],
  ]);
  vi.mocked(mapPlanSteps).mockImplementationOnce((plan, transform) => {
    const [step] = plan.nodes;
    if (step?.type !== "agent") return plan;
    const foreign = structuredClone(step);
    Object.defineProperty(foreign, "type", { value: "script" });
    return { ...plan, nodes: [transform(foreign)] };
  });
  await new AgentProfileRemoval(transaction).remove("p1");
  const stored: unknown = JSON.parse(
    String(execute.mock.calls[0]?.[1]?.plan_json),
  );
  expect(stored).toMatchObject({
    nodes: [{ id: "a", type: "script", agentId: "p1" }],
  });
});
