import { describe, expect, it } from "vitest";

import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ROLE } from "@/definition/Role";

import { useMigratedDatabase } from "../helpers/test-database";

import type { NewSession } from "@/backend/database/repositories/SessionRepository";

function createSession(overrides: Partial<NewSession> = {}): NewSession {
  return {
    id: "session-1",
    lifetimeDays: 14,
    tokenHash: "hash-1",
    userId: "user-1",
    ...overrides,
  };
}

describe("SessionRepository on DuckDB", () => {
  const getDatabase = useMigratedDatabase();

  async function createRepository(): Promise<SessionRepository> {
    const users = new UserRepository(getDatabase());

    await users.insert({
      displayName: "Anna",
      id: "user-1",
      passwordHash: "hash",
      role: ROLE.EMPLOYEE,
      username: "anna",
    });
    await users.insert({
      displayName: "Bob",
      id: "user-2",
      passwordHash: "hash",
      role: ROLE.EMPLOYEE,
      username: "bob",
    });

    return new SessionRepository(getDatabase());
  }

  it("expires sessions after their lifetime", async () => {
    const repository = await createRepository();

    await repository.insert(createSession({ lifetimeDays: 14 }));
    await repository.insert(
      createSession({ id: "session-2", lifetimeDays: -1, tokenHash: "hash-2" }),
    );

    await expect(repository.findUserIdByTokenHash("hash-1")).resolves.toBe(
      "user-1",
    );
    await expect(repository.findUserIdByTokenHash("hash-2")).resolves.toBe(
      null,
    );
  });

  it("does not persist a session if the account was deactivated during login", async () => {
    const repository = await createRepository();
    await new UserRepository(getDatabase()).setActive("user-1", false);
    await repository.insert(createSession());
    await new UserRepository(getDatabase()).setActive("user-1", true);
    expect(await repository.findUserIdByTokenHash("hash-1")).toBeNull();
  });

  it("stamps the creation time in the stored text format", async () => {
    const repository = await createRepository();

    await repository.insert(createSession({ userAgent: "Firefox on Linux" }));

    const [session] = await repository.listActiveByUserId("user-1", "hash-1");

    expect(session?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u,
    );
    expect(session?.userAgent).toBe("Firefox on Linux");
  });

  describe("markUsed", () => {
    it("leaves a session alone that was used a moment ago", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());
      const [before] = await repository.listActiveByUserId("user-1", "hash-1");

      await repository.markUsed("hash-1");

      const [after] = await repository.listActiveByUserId("user-1", "hash-1");

      expect(after?.lastUsedAt).toBe(before?.lastUsedAt);
    });

    it("refreshes a session that was idle for more than a minute", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());
      await getDatabase().execute(
        "UPDATE sessions SET last_used_at = '2000-01-01 00:00:00';",
      );

      await repository.markUsed("hash-1");

      const [session] = await repository.listActiveByUserId("user-1", "hash-1");

      expect(session?.lastUsedAt > "2000-01-01 00:00:00").toBe(true);
    });
  });

  describe("listActiveByUserId", () => {
    it("lists the current session first, then the most recent ones", async () => {
      const repository = await createRepository();

      await repository.insert(createSession({ id: "a", tokenHash: "hash-a" }));
      await repository.insert(createSession({ id: "b", tokenHash: "hash-b" }));
      await repository.insert(createSession({ id: "c", tokenHash: "hash-c" }));
      await getDatabase().execute(
        "UPDATE sessions SET last_used_at = '2026-01-01 10:00:00' WHERE id = 'a';" +
          "UPDATE sessions SET last_used_at = '2026-01-03 10:00:00' WHERE id = 'b';" +
          "UPDATE sessions SET last_used_at = '2026-01-02 10:00:00' WHERE id = 'c';",
      );

      const sessions = await repository.listActiveByUserId("user-1", "hash-a");

      expect(
        sessions.map((session) => [session.id, session.isCurrent]),
      ).toEqual([
        ["a", true],
        ["b", false],
        ["c", false],
      ]);
    });

    it("skips expired sessions and sessions of other users", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());
      await repository.insert(
        createSession({ id: "old", lifetimeDays: -1, tokenHash: "hash-old" }),
      );
      await repository.insert(
        createSession({
          id: "other",
          tokenHash: "hash-other",
          userId: "user-2",
        }),
      );

      const sessions = await repository.listActiveByUserId("user-1", "hash-1");

      expect(sessions.map((session) => session.id)).toEqual(["session-1"]);
    });
  });

  describe("single session lookups", () => {
    it("finds the token hash of an active session of the owner", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());

      await expect(
        repository.findTokenHashByIdAndUserId("session-1", "user-1"),
      ).resolves.toBe("hash-1");
    });

    it.each([
      ["another user", "session-1", "user-2"],
      ["an unknown session", "missing", "user-1"],
    ])("finds nothing for %s", async (_label, sessionId, userId) => {
      const repository = await createRepository();

      await repository.insert(createSession());

      await expect(
        repository.findTokenHashByIdAndUserId(sessionId, userId),
      ).resolves.toBe(null);
    });
  });

  describe("revoking sessions", () => {
    async function countSessions(): Promise<unknown> {
      const [[count]] = await getDatabase().query(
        "SELECT COUNT(*) FROM sessions;",
      );

      return count;
    }

    it("deletes one session of its owner only", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());

      await repository.deleteByIdAndUserId("session-1", "user-2");
      await expect(countSessions()).resolves.toBe(1);

      await repository.deleteByIdAndUserId("session-1", "user-1");
      await expect(countSessions()).resolves.toBe(0);
    });

    it("deletes every other session of a user", async () => {
      const repository = await createRepository();

      await repository.insert(createSession({ id: "a", tokenHash: "hash-a" }));
      await repository.insert(createSession({ id: "b", tokenHash: "hash-b" }));
      await repository.insert(
        createSession({ id: "c", tokenHash: "hash-c", userId: "user-2" }),
      );

      await repository.deleteAllExceptTokenHash("user-1", "hash-a");

      const sessions = await getDatabase().query(
        "SELECT id FROM sessions ORDER BY id;",
      );

      expect(sessions).toEqual([["a"], ["c"]]);
    });

    it("deletes every session of a user", async () => {
      const repository = await createRepository();

      await repository.insert(createSession({ id: "a", tokenHash: "hash-a" }));
      await repository.insert(
        createSession({ id: "c", tokenHash: "hash-c", userId: "user-2" }),
      );

      await repository.deleteAllByUserId("user-1");

      await expect(
        getDatabase().query("SELECT id FROM sessions;"),
      ).resolves.toEqual([["c"]]);
    });

    it("deletes one session by token hash", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());
      await repository.deleteByTokenHash("hash-1");

      await expect(countSessions()).resolves.toBe(0);
    });

    it("deletes expired sessions only", async () => {
      const repository = await createRepository();

      await repository.insert(createSession());
      await repository.insert(
        createSession({ id: "old", lifetimeDays: -1, tokenHash: "hash-old" }),
      );

      await repository.deleteExpired();

      await expect(
        getDatabase().query("SELECT id FROM sessions;"),
      ).resolves.toEqual([["session-1"]]);
    });
  });
});
