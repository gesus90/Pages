import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AdministrationActivityRepository } from "./AdministrationActivityRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentAdminChanged } from "@/definition/AgentAdministration";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: AdministrationActivityRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  const repository = new AdministrationActivityRepository({
    execute,
    query,
  } as unknown as Pick<DatabaseTransaction, "execute" | "query">);
  return { repository, execute, query };
}

it("inserts the public outcome with a generated identifier", async () => {
  const { repository, execute } = repositoryOf();
  const result: AgentAdminChanged = {
    targetType: "person",
    id: "u1",
    changed: true,
    affectedUserIds: [],
  };
  await repository.insert({
    actorId: "a1",
    operation: "rename",
    source: "ui",
    result,
  });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO administration_activity"),
    expect.objectContaining({
      actor_id: "a1",
      operation: "rename",
      source: "ui",
      target_type: "person",
      target_id: "u1",
      changes: JSON.stringify(result),
    }),
  );
  const call = execute.mock.calls[0] as unknown as [string, { id: unknown }];
  expect(typeof call[1].id).toBe("string");
});

it("maps stored activity rows", async () => {
  const { repository } = repositoryOf([
    ["i", "a", "op", "mcp", "user", "t", "{}", "2026-01-01"],
  ]);
  await expect(repository.findAll()).resolves.toEqual([
    {
      id: "i",
      actorId: "a",
      operation: "op",
      source: "mcp",
      targetType: "user",
      targetId: "t",
      changes: "{}",
      createdAt: "2026-01-01",
    },
  ]);
});

it.each(["ui", "ai"])("accepts the source %s", async (source) => {
  const { repository } = repositoryOf([
    ["i", "a", "o", source, "x", "t", "{}", "d"],
  ]);
  await expect(repository.findAll()).resolves.toHaveLength(1);
});

it("rejects an unknown source", async () => {
  const { repository } = repositoryOf([
    ["i", "a", "o", "cli", "x", "t", "{}", "d"],
  ]);
  await expect(repository.findAll()).rejects.toThrow(
    "Invalid administration activity source.",
  );
});
