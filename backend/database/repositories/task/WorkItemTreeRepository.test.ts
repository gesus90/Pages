import { describe, expect, it, vi } from "vitest";

import { WorkItemTreeRepository } from "./WorkItemTreeRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: Database;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => {});
  return {
    database: { query, execute } as unknown as Database,
    query,
    execute,
  };
}

describe("WorkItemTreeRepository", () => {
  it("lists the open branch keys", async () => {
    const { database, query } = databaseOf([["a"], ["b"]]);

    await expect(
      new WorkItemTreeRepository(database).findExpandedKeys("u"),
    ).resolves.toEqual(["a", "b"]);
    expect(query).toHaveBeenCalledWith(expect.any(String), { user_id: "u" });
  });

  it("inserts a branch when it opens", async () => {
    const { database, execute } = databaseOf([]);

    await new WorkItemTreeRepository(database).setExpanded("u", "k", true);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO"),
      { node_key: "k", user_id: "u" },
    );
  });

  it("deletes a branch when it closes", async () => {
    const { database, execute } = databaseOf([]);

    await new WorkItemTreeRepository(database).setExpanded("u", "k", false);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM"),
      { node_key: "k", user_id: "u" },
    );
  });

  it("counts the open branches", async () => {
    const { database } = databaseOf([[3]]);

    await expect(
      new WorkItemTreeRepository(database).countExpanded("u"),
    ).resolves.toBe(3);
  });

  it("rejects a missing count row", async () => {
    const { database } = databaseOf([]);

    await expect(
      new WorkItemTreeRepository(database).countExpanded("u"),
    ).rejects.toThrow("count");
  });
});
