import { expect, it, vi, type Mock } from "vitest";

import { AgentWorkspaceReferencesRepository } from "./AgentWorkspaceReferencesRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown): unknown => input,
}));

function databaseOf(...answers: DatabaseValue[][][]): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers) query.mockResolvedValueOnce(rows);
  return { database: { execute, query }, execute, query };
}

function sqlOf(call: readonly unknown[] | undefined): string {
  const statement = call?.[0];
  return typeof statement === "string" ? statement : "";
}

it("lists the usages of a registration", async () => {
  const { database, query } = databaseOf([
    ["a1", "Agent", "agent"],
    ["r1", null, "run"],
  ]);
  await expect(
    new AgentWorkspaceReferencesRepository(database).usages("w1"),
  ).resolves.toEqual([
    { id: "a1", name: "Agent", kind: "agent" },
    { id: "r1", name: null, kind: "run" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ id: "w1" });
});

it("rejects an unknown usage kind", async () => {
  const { database } = databaseOf([["x", null, "other"]]);
  await expect(
    new AgentWorkspaceReferencesRepository(database).usages("w1"),
  ).rejects.toMatchObject({ code: "workspace_invalid" });
});

it("detaches runs, plans, agents and templates", async () => {
  const run = JSON.stringify({ id: "r1", stopRequested: false });
  const { database, execute } = databaseOf(
    [
      ["r1", null, "run"],
      ["r2", null, "run"],
      ["p1", "Plan", "plan"],
      ["a1", "Agent", "agent"],
    ],
    [[run]],
    [],
    [["p1", JSON.stringify({ workspaceId: "w1", nodes: [] })]],
    [["a1", JSON.stringify({ workspaceId: "w1" })]],
    [["t1", JSON.stringify({ workspaceId: "w1" })]],
  );
  await new AgentWorkspaceReferencesRepository(database).detach("w1", {
    userId: "u1",
    name: "W",
  });
  const calls = execute.mock.calls;
  expect(calls[0]?.[1]).toEqual({
    id: "r1",
    view_json: JSON.stringify({ id: "r1", stopRequested: true }),
  });
  expect(calls[1]?.[1]).toEqual({
    workspace_id: "w1",
    run_id: "r1",
    removed_by: "u1",
    name: "W",
  });
  expect(calls[2]?.[1]).toMatchObject({ run_id: "r2" });
  expect(calls[3]?.[1]).toEqual({
    plan_id: "p1",
    workspace_id: "",
    plan_json: JSON.stringify({ workspaceId: "", nodes: [] }),
  });
  expect(calls[4]?.[1]).toEqual({
    profile_id: "a1",
    configuration_json: JSON.stringify({ workspaceId: "" }),
  });
  expect(sqlOf(calls[5])).toContain("agent_plan_templates");
  expect(calls[5]?.[1]).toEqual({
    id: "t1",
    node_json: JSON.stringify({ workspaceId: "" }),
  });
});

it("detaches only templates when nothing else references the registration", async () => {
  const { database, execute } = databaseOf([], []);
  await new AgentWorkspaceReferencesRepository(database).detach("w1", {
    userId: "u1",
    name: "W",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("keeps a plan binding that is not cleared to text", async () => {
  const { database, execute } = databaseOf(
    [["p1", "Plan", "plan"]],
    [["p1", JSON.stringify({ nodes: [] })]],
  );
  await new AgentWorkspaceReferencesRepository(database).detach("w1", {
    userId: "u1",
    name: "W",
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ workspace_id: "" });
});

it("rejects a stored plan that is not an object", async () => {
  const { database } = databaseOf([["p1", "Plan", "plan"]], [["p1", "[]"]]);
  await expect(
    new AgentWorkspaceReferencesRepository(database).detach("w1", {
      userId: "u1",
      name: "W",
    }),
  ).rejects.toMatchObject({ code: "plan_invalid" });
});

it("requires every referenced registration to exist", async () => {
  const { database, query } = databaseOf([["w1"]], [["w2"]]);
  const repository = new AgentWorkspaceReferencesRepository(database);
  await repository.requireReferences({
    nodes: [{ workspaceId: "w1" }, { workspaceId: "w2" }, { workspaceId: "" }],
  });
  expect(query).toHaveBeenCalledTimes(2);
  await expect(
    repository.requireReferences({ workspaceId: "gone" }),
  ).rejects.toMatchObject({ code: "workspace_not_found" });
});
