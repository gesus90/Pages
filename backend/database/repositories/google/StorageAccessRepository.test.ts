import { expect, it, vi } from "vitest";

import { StorageAccessRepository } from "./StorageAccessRepository";

import type { StorageGrant } from "@/definition/StorageAccess";

function doubleOf(rows: unknown[][] = []): {
  repository: StorageAccessRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn();
  return {
    repository: new StorageAccessRepository({
      query,
      execute,
    } as unknown as ConstructorParameters<typeof StorageAccessRepository>[0]),
    query,
    execute,
  };
}

const GRANT: StorageGrant = {
  permissionId: "p1",
  folderRef: "r1",
  folderName: "Docs",
  targetKind: "group",
  targetId: "g1",
};

it("maps grants for an account", async () => {
  const { repository, query } = doubleOf([["p1", "r1", "Docs", "group", "g1"]]);

  await expect(repository.grants("u1", "p1")).resolves.toEqual([GRANT]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    permission_id: "p1",
  });
});

it("rejects a grant with an unknown recipient kind", async () => {
  const { repository } = doubleOf([["p1", "r1", "Docs", "user", "g1"]]);

  await expect(repository.grants(null, "p1")).rejects.toThrow(
    "Invalid Storage grant recipient.",
  );
});

it.each(["role", "department", "group"])("maps %s targets", async (kind) => {
  const { repository } = doubleOf([[kind, "i1", "Name"]]);

  await expect(repository.targets()).resolves.toEqual([
    { kind, id: "i1", name: "Name" },
  ]);
});

it("rejects a target of an unknown kind", async () => {
  const { repository } = doubleOf([["user", "i1", "Name"]]);

  await expect(repository.targets()).rejects.toThrow("Invalid Storage target.");
});

it("inserts an enabled grant and deletes a revoked one", async () => {
  const { repository, execute } = doubleOf();

  await repository.setGrant(GRANT, true);
  await repository.setGrant(GRANT, false);

  expect(String(execute.mock.calls[0]?.[0])).toContain("INSERT");
  expect(String(execute.mock.calls[1]?.[0])).toContain("DELETE");
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ target_id: "g1" });
});

it("records metadata with a generated id", async () => {
  const { repository, execute } = doubleOf();

  await repository.record(
    { actorId: "u1", actorName: "Ann", operation: "list", ref: "r1" },
    "p1",
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    actor_id: "u1",
    actor_name: "Ann",
    operation: "list",
    ref: "r1",
    permission_id: "p1",
  });
});

it("maps the history", async () => {
  const { repository } = doubleOf([["u1", "Ann", "list", "r1", "2026-01-01"]]);

  await expect(repository.history(null, "p1")).resolves.toEqual([
    {
      actorId: "u1",
      actorName: "Ann",
      operation: "list",
      ref: "r1",
      createdAt: "2026-01-01",
    },
  ]);
});
