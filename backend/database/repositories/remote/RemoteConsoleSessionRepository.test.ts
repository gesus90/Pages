import { describe, expect, it, vi } from "vitest";

import { RemoteConsoleSessionRepository } from "./RemoteConsoleSessionRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { StoredConsoleSession } from "./RemoteConsoleSessionRepository";

const SESSION: StoredConsoleSession = {
  id: "s1",
  ownerId: "u1",
  scopeKind: "workspace",
  scopeId: "w1",
  columns: 80,
  rows: 24,
  attempts: 1,
  lastSequence: 9,
};

function doubleOf(rows: DatabaseValue[][] = []): {
  repository: RemoteConsoleSessionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new RemoteConsoleSessionRepository({ query, execute }),
    query,
    execute,
  };
}

describe("RemoteConsoleSessionRepository", () => {
  it("stores a console with its lease", async () => {
    const { repository, execute } = doubleOf();

    await repository.save(SESSION, 60);

    expect(execute.mock.calls[0]?.[1]).toEqual({
      id: "s1",
      owner_id: "u1",
      scope_kind: "workspace",
      scope_id: "w1",
      column_count: 80,
      row_count: 24,
      attempts: 1,
      last_sequence: 9,
      lease_seconds: 60,
    });
  });

  it.each(["workspace", "connection"] as const)(
    "finds a %s console",
    async (kind) => {
      const { repository } = doubleOf([["s1", "u1", kind, "w1", 80, 24, 1, 9]]);

      await expect(repository.find("s1")).resolves.toEqual({
        ...SESSION,
        scopeKind: kind,
      });
    },
  );

  it("returns null for an unknown or expired console", async () => {
    await expect(doubleOf([]).repository.find("s1")).resolves.toBeNull();
  });

  it("rejects an invalid scope kind", async () => {
    const { repository } = doubleOf([
      ["s1", "u1", "other", "w1", 80, 24, 1, 9],
    ]);

    await expect(repository.find("s1")).rejects.toThrow('"scope_kind"');
  });

  it("removes one console", async () => {
    const { repository, execute } = doubleOf();

    await repository.remove("s1");

    expect(execute.mock.calls[0]?.[1]).toEqual({ id: "s1" });
  });

  it("removes expired consoles", async () => {
    const { repository, execute } = doubleOf();

    await repository.removeExpired();

    expect(execute.mock.calls[0]?.[0]).toContain("expires_at <=");
  });
});
