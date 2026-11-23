import { expect, it, vi } from "vitest";

import { RunnerDeployKeyRepository } from "./RunnerDeployKeyRepository";

import type { Database } from "@/backend/database/Database";

type Call = (...parameters: unknown[]) => Promise<undefined>;

function doubleOf(rows: unknown[][]): {
  database: Database;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn<Call>(async () => undefined);
  return {
    database: { query, execute } as unknown as Database,
    query,
    execute,
  };
}

it("lists the stored keys of a project", async () => {
  const { database, query } = doubleOf([["k1", "ssh-ed25519 AAA", "Main"]]);

  const keys = await new RunnerDeployKeyRepository(database).list("p1");

  expect(keys).toEqual([{ id: "k1", key: "ssh-ed25519 AAA", title: "Main" }]);
  expect(query.mock.calls[0]?.[1]).toEqual({ project_id: "p1" });
});

it("records a key idempotently and returns the stored entry", async () => {
  const { database, execute } = doubleOf([["k1", "ssh-ed25519 AAA", "Main"]]);

  const stored = await new RunnerDeployKeyRepository(database).create({
    projectId: "p1",
    key: "ssh-ed25519 AAA",
    title: "Main",
  });

  expect(stored.id).toBe("k1");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    project_id: "p1",
    public_key: "ssh-ed25519 AAA",
    title: "Main",
  });
});

it("fails when the key cannot be read back", async () => {
  const { database } = doubleOf([]);

  await expect(
    new RunnerDeployKeyRepository(database).create({
      projectId: "p1",
      key: "x",
      title: "t",
    }),
  ).rejects.toThrow("Offline deploy key was not stored");
});
