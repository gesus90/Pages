import { expect, it, vi } from "vitest";

import {
  AgentPlanAgentTodoService,
  withAgentTodos,
} from "@/backend/service/agents/AgentPlanAgentTodoService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";

it("reads valid lists and isolates malformed stored rows", async () => {
  const listForRun = vi
    .fn<AgentPlanAgentTodoRepository["listForRun"]>()
    .mockResolvedValue([
      partial({
        attemptId: "one",
        todosJson: JSON.stringify([
          { id: "1", text: "Write", status: "active", updatedAt: "now" },
        ]),
        updatedAt: "now",
      }),
      partial({ attemptId: "broken", todosJson: "{", updatedAt: "now" }),
    ]);
  const lists = await new AgentPlanAgentTodoService({ listForRun }).listForRun(
    "run",
  );
  expect([...lists.keys()]).toEqual(["one"]);
  expect(lists.get("one")?.todos).toEqual([
    { id: "1", text: "Write", status: "active", updatedAt: "now" },
  ]);
});

it("attaches lists to matching outer and loop attempts without changing the input", () => {
  const run = partial<AgentPlanRun>({
    steps: [{ id: "step", execution: { attemptId: "one" } }, { id: "other" }],
    loops: [
      {
        iterations: [
          { nodes: [{ id: "inner", execution: { attemptId: "one" } }] },
        ],
      },
    ],
  });
  const list = { attemptId: "one", todos: [], updatedAt: "now" };
  expect(withAgentTodos(run, new Map())).toBe(run);
  const result = withAgentTodos(run, new Map([["one", list]]));
  expect(result.steps[0]).toMatchObject({ agentTodos: list });
  expect(result.steps[1]).toBe(run.steps[1]);
  expect(result.loops?.[0]?.iterations[0]?.nodes[0]).toMatchObject({
    agentTodos: list,
  });
  expect(run.steps[0]).not.toHaveProperty("agentTodos");
});
