import { describe, expect, it, vi } from "vitest";

import { WorkItemKeyRepository } from "./WorkItemKeyRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: TaskDatabase;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn(async () => {});
  return {
    database: { query, execute } as unknown as TaskDatabase,
    query,
    execute,
  };
}

describe("WorkItemKeyRepository.findOrCreateProjectKey", () => {
  it("returns the stored key", async () => {
    const { database, execute } = databaseOf([["ABC"]]);

    await expect(
      new WorkItemKeyRepository(database).findOrCreateProjectKey("p", "DEF"),
    ).resolves.toBe("ABC");
    expect(execute).not.toHaveBeenCalled();
  });

  it("registers the default key and returns the confirmed key", async () => {
    const { database, execute } = databaseOf([], [["WON"]]);

    await expect(
      new WorkItemKeyRepository(database).findOrCreateProjectKey("p", "DEF"),
    ).resolves.toBe("WON");
    expect(execute).toHaveBeenCalledWith(expect.any(String), {
      key: "DEF",
      project_id: "p",
    });
  });

  it("falls back to the default key when nothing confirms it", async () => {
    const { database } = databaseOf([], []);

    await expect(
      new WorkItemKeyRepository(database).findOrCreateProjectKey("p", "DEF"),
    ).resolves.toBe("DEF");
  });
});

describe("WorkItemKeyRepository.reserveNumbers", () => {
  it("returns the first reserved number", async () => {
    const { database, query } = databaseOf([[10]]);

    await expect(
      new WorkItemKeyRepository(database).reserveNumbers("p", 3),
    ).resolves.toBe(8);
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      count: 3,
      project_id: "p",
    });
  });

  it("rejects a project without a key", async () => {
    const { database } = databaseOf([]);

    await expect(
      new WorkItemKeyRepository(database).reserveNumbers("p", 1),
    ).rejects.toThrow('Project "p" has no ticket key.');
  });
});
