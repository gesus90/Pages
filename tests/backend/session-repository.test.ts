import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionRepository } from "@/backend/database/repositories/SessionRepository";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

describe("SessionRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: SessionRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new SessionRepository(database);
  });

  it("inserts a session with an expiry derived from its lifetime", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.insert({
      id: "session-1",
      lifetimeDays: 30,
      tokenHash: "token-hash",
      userId: "user-1",
    });

    expect(database.execute).toHaveBeenCalledTimes(1);
    const [statement, parameters] = database.execute.mock.calls[0] as [
      string,
      Record<string, string | number>,
    ];

    expect(statement).toContain("INSERT INTO sessions");
    expect(parameters).toEqual({
      id: "session-1",
      lifetime_days: 30,
      token_hash: "token-hash",
      user_id: "user-1",
    });
  });

  it("returns the owner of an unexpired session", async () => {
    database.query.mockResolvedValue([["user-1"]]);

    await expect(repository.findUserIdByTokenHash("token-hash")).resolves.toBe(
      "user-1",
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("expires_at > CURRENT_TIMESTAMP"),
      { token_hash: "token-hash" },
    );
  });

  it("returns null when no valid session exists", async () => {
    database.query.mockResolvedValue([]);

    await expect(
      repository.findUserIdByTokenHash("unknown"),
    ).resolves.toBeNull();
  });

  it("records session use", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.markUsed("token-hash");

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("last_used_at"),
      { token_hash: "token-hash" },
    );
  });

  it("deletes a session by token hash", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.deleteByTokenHash("token-hash");

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM sessions"),
      { token_hash: "token-hash" },
    );
  });

  it("deletes expired sessions without parameters", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.deleteExpired();

    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(database.execute.mock.calls[0]?.[0]).toContain(
      "expires_at <= CURRENT_TIMESTAMP",
    );
  });

  it("propagates database failures", async () => {
    database.query.mockRejectedValue(new Error("Query failed"));

    await expect(repository.findUserIdByTokenHash("hash")).rejects.toThrow(
      "Query failed",
    );

    database.execute.mockRejectedValue(new Error("Write failed"));

    await expect(
      repository.insert({
        id: "session-1",
        lifetimeDays: 30,
        tokenHash: "hash",
        userId: "user-1",
      }),
    ).rejects.toThrow("Write failed");
    await expect(repository.markUsed("hash")).rejects.toThrow("Write failed");
    await expect(repository.deleteByTokenHash("hash")).rejects.toThrow(
      "Write failed",
    );
    await expect(repository.deleteExpired()).rejects.toThrow("Write failed");
  });
});
