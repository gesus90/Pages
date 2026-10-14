import { expect, it, vi } from "vitest";

import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { RemovalDatabase } from "./page53-removal-database";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";

it("rejects a new user agent if its model was deleted after service validation", async () => {
  const execute = vi.fn();
  const transaction: DatabaseTransaction = { query: async () => [], execute };
  const repository = new AgentProfileRepository({
    transaction: (work) => work(transaction),
  });
  await expect(
    repository.save({
      id: "new",
      name: "Synthetic",
      ownerId: "owner",
      modelProfileId: "removed",
      connectionId: "connection",
      model: "model",
      reasoningEffort: null,
      isActive: true,
      purposes: ["agent"],
      targets: [],
      configuration: emptyAgentConfiguration(),
    }),
  ).rejects.toMatchObject({ code: "model_assignment_missing" });
  expect(execute).not.toHaveBeenCalled();
});

function plan(): AgentPlan {
  const database = new RemovalDatabase();
  database.link(0);
  return {
    ...database.plans[0].input,
    id: "plan",
    ownerId: "owner",
    projectId: "project",
    revision: 4,
  };
}

it.each(["removed", "other"])(
  "rejects a new plan if referenced agent %s disappeared after service validation",
  async (missingId) => {
    const execute = vi.fn();
    const transaction: DatabaseTransaction = {
      execute,
      query: async (statement, parameters) => {
        if (statement.includes("FROM agent_plans")) return [];
        if (statement.includes("FROM agent_workspaces")) return [["project"]];
        if (statement.includes("FROM agent_execution_profiles"))
          return parameters?.id === missingId ? [] : [[String(parameters?.id)]];
        throw new Error("Unexpected query");
      },
    };
    const repository = new AgentPlanRepository({
      query: transaction.query,
      transaction: (work) => work(transaction),
    });
    await expect(repository.save(plan(), true)).rejects.toMatchObject({
      code: "plan_context_changed",
    });
    expect(execute).not.toHaveBeenCalled();
  },
);

it("rejects an old plan revision after deletion cleared a reference", async () => {
  const previous = plan();
  const execute = vi.fn();
  const transaction: DatabaseTransaction = {
    execute,
    query: async () => [
      [
        previous.id,
        previous.ownerId,
        previous.projectId,
        5,
        JSON.stringify(previous),
      ],
    ],
  };
  const repository = new AgentPlanRepository({
    query: transaction.query,
    transaction: (work) => work(transaction),
  });
  await expect(repository.save(previous, false)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("saves an explicitly repaired plan without dropping its nodes, edges or bindings", async () => {
  const previous = plan();
  const execute = vi.fn();
  const transaction: DatabaseTransaction = {
    execute,
    query: async (statement) => {
      if (statement.includes("FROM agent_plans"))
        return [
          [
            previous.id,
            previous.ownerId,
            previous.projectId,
            4,
            JSON.stringify(previous),
          ],
        ];
      if (statement.includes("FROM agent_workspaces")) return [["project"]];
      if (statement.includes("FROM agent_execution_profiles"))
        return [["replacement"]];
      throw new Error("Unexpected query");
    },
  };
  const repository = new AgentPlanRepository({
    query: transaction.query,
    transaction: (work) => work(transaction),
  });
  const repaired = {
    ...previous,
    nodes: previous.nodes.map((node) =>
      node.type === "agent"
        ? { ...node, agentId: "replacement", personalAgentId: null }
        : node,
    ),
  };
  await repository.save(repaired, false);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO agent_plans"),
    expect.objectContaining({ plan_json: JSON.stringify(repaired) }),
  );
});

it("reads emptied references while rejecting malformed external identifiers", () => {
  const previous = plan();
  const cleared = {
    ...previous,
    nodes: previous.nodes.map((node) =>
      node.type === "agent"
        ? { ...node, agentId: "", personalAgentId: "" }
        : node,
    ),
  };
  expect(readPlanInput(cleared).nodes).toEqual(cleared.nodes);
  expect(() =>
    readPlanInput({
      ...cleared,
      nodes: [{ ...cleared.nodes[0], agentId: null }],
    }),
  ).toThrow();
});
