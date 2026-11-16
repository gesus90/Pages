import { expect, it, vi } from "vitest";

import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";

import { partial } from "../../app/lib/service-wiring-fakes";
import { script } from "../../definition/plan-fixtures";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

it("scopes reads to personal and authorized team templates and ignores future node types", async () => {
  const node = script("script");
  const query = vi.fn(async () => [
    [
      "id",
      "Template",
      "script",
      JSON.stringify(node),
      "2030-01-01",
      "department",
    ],
    ["future", "Future", "unknown", "{}", "2030-01-01", null],
  ]);
  const repository = new AgentPlanTemplateRepository(
    partial<Pick<Database, "transaction" | "query">>({ query }),
  );
  await expect(
    repository.list({
      ownerId: "owner",
      projectId: "project",
      departmentIds: ["department", "other"],
    }),
  ).resolves.toMatchObject([{ id: "id", type: "script", isShared: true }]);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("department_id IN ($department_0, $department_1)"),
    {
      owner_id: "owner",
      project_id: "project",
      department_0: "department",
      department_1: "other",
    },
  );
});

it("returns missing templates and rejects mismatched stored node types", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      [
        "id",
        "Name",
        "agent",
        JSON.stringify(script("script")),
        "2030-01-01",
        null,
      ],
    ]);
  const repository = new AgentPlanTemplateRepository(
    partial<Pick<Database, "transaction" | "query">>({ query }),
  );
  const scope = { ownerId: "owner", projectId: null, departmentIds: [] };
  await expect(repository.find(scope, "missing")).resolves.toBeNull();
  await expect(repository.find(scope, "id")).rejects.toMatchObject({
    code: "template_invalid",
  });
  expect(query).toHaveBeenLastCalledWith(
    expect.stringContaining("owner_id = $owner_id"),
    { owner_id: "owner", id: "id" },
  );
});

it("creates and journals a template inside the transaction", async () => {
  const node = script("script");
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      ["id", "Template", "script", JSON.stringify(node), "2030-01-01", null],
    ]);
  const execute = vi.fn(async () => undefined);
  const transaction = partial<DatabaseTransaction>({ query, execute });
  const database = partial<Pick<Database, "transaction" | "query">>({
    transaction: async (
      work: (value: DatabaseTransaction) => Promise<unknown>,
    ) => work(transaction),
  });
  const journal = vi.fn(async () => undefined);
  const result = await new AgentPlanTemplateRepository(database).create(
    { id: "id", ownerId: "owner", name: "Template", node, team: null },
    journal,
  );
  expect(result).toMatchObject({ id: "id", isShared: false });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO agent_plan_templates"),
    expect.objectContaining({ owner_id: "owner", name_key: "template" }),
  );
  expect(journal).toHaveBeenCalledWith(transaction, result);
});

it("refuses duplicate names and changes by a non-owner before writing", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([["taken"]])
    .mockResolvedValueOnce([]);
  const execute = vi.fn();
  const transaction = partial<DatabaseTransaction>({ query, execute });
  const database = partial<Pick<Database, "transaction" | "query">>({
    transaction: async (
      work: (value: DatabaseTransaction) => Promise<unknown>,
    ) => work(transaction),
  });
  const repository = new AgentPlanTemplateRepository(database);
  await expect(
    repository.create({
      id: "id",
      ownerId: "owner",
      name: "Template",
      node: script("script"),
      team: null,
    }),
  ).rejects.toMatchObject({ code: "template_name_taken" });
  await expect(
    repository.update({ id: "id", ownerId: "other", name: "New", node: null }),
  ).rejects.toMatchObject({ code: "template_owner_only" });
  expect(execute).not.toHaveBeenCalled();
});
