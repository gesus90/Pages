import { beforeEach, describe, expect, it } from "vitest";

import { SessionRepository } from "@/backend/database/repositories/SessionRepository";

import { createDatabase } from "../helpers/factories";

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
      lifetimeDays: 14,
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
      lifetime_days: 14,
      token_hash: "token-hash",
      user_agent: null,
      user_id: "user-1",
    });
  });

  it("stores the user agent of the browser that started the session", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.insert({
      id: "session-2",
      lifetimeDays: 7,
      tokenHash: "other-hash",
      userAgent: "Mozilla/5.0 Firefox/130",
      userId: "user-1",
    });

    const [, parameters] = database.execute.mock.calls[0] as [
      string,
      Record<string, string | number>,
    ];

    expect(parameters).toMatchObject({
      lifetime_days: 7,
      user_agent: "Mozilla/5.0 Firefox/130",
    });
  });

  it("returns the owner of an unexpired session", async () => {
    database.query.mockResolvedValue([["user-1"]]);

    await expect(repository.findUserIdByTokenHash("token-hash")).resolves.toBe(
      "user-1",
    );
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("expires_at > utc_now()"),
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

  it("deletes every session of a user", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.deleteAllByUserId("user-1");

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM sessions"),
      { user_id: "user-1" },
    );
  });

  it("deletes expired sessions without parameters", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.deleteExpired();

    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(database.execute.mock.calls[0]?.[0]).toContain(
      "expires_at <= utc_now()",
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
        lifetimeDays: 14,
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
