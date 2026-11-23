import { expect, it, vi } from "vitest";

import {
  requirePlanConnections,
  requireRemotePlanModels,
} from "./AgentPlanStoredReferences";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";

const mocked = vi.hoisted(() => ({ steps: [] as unknown[] }));

vi.mock("@/definition/AgentPlanGroup", () => ({
  allPlanSteps: () => mocked.steps,
}));

function planWith(steps: readonly unknown[]): AgentPlan {
  mocked.steps = [...steps];
  return {
    id: "plan",
    ownerId: "u1",
    projectId: "p1",
    revision: 1,
    name: "Plan",
    workspaceId: "w",
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
  };
}

function transactionOf(...answers: string[][][]): Pick<
  DatabaseTransaction,
  "query" | "execute"
> & {
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers) query.mockResolvedValueOnce(rows);
  return { query, execute: vi.fn() };
}

it("accepts stored connections and ignores steps without one", async () => {
  const transaction = transactionOf([["c1"]]);
  const plan = planWith([
    { configuration: { connectionId: "c1" } },
    { configuration: { connectionId: "c1" } },
    { configuration: {} },
    {},
  ]);

  await requirePlanConnections(transaction, plan);

  expect(transaction.query).toHaveBeenCalledTimes(1);
});

it("skips the simulation connections", async () => {
  const transaction = transactionOf();
  const plan = planWith([
    { configuration: { connectionId: "pages-simulation" } },
    { configuration: { connectionId: "pages-simulation-remote" } },
  ]);

  await requirePlanConnections(transaction, plan);

  expect(transaction.query).not.toHaveBeenCalled();
});

it("refuses a connection that is gone", async () => {
  const plan = planWith([{ configuration: { connectionId: "gone" } }]);

  await expect(
    requirePlanConnections(transactionOf(), plan),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
});

it("accepts remote routes that fit the project", async () => {
  const transaction = transactionOf([["w1"]]);
  const plan = planWith([
    {
      configuration: { runnerRoute: { workspaceId: "w1", connectionId: "c1" } },
    },
    { configuration: {} },
    {},
  ]);

  await requireRemotePlanModels(transaction, plan);

  expect(transaction.query.mock.calls[0]?.[1]).toEqual({
    workspace_id: "w1",
    project_id: "p1",
    connection_id: "c1",
  });
});

it("refuses a remote route outside the project", async () => {
  const plan = planWith([
    {
      configuration: { runnerRoute: { workspaceId: "w1", connectionId: "c1" } },
    },
  ]);

  await expect(
    requireRemotePlanModels(transactionOf(), plan),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
});
