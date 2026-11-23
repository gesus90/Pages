import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { SessionRepository } from "./SessionRepository";

import type { Database } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: SessionRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  return {
    execute,
    query,
    repository: new SessionRepository({
      execute,
      query,
    } as unknown as Database),
  };
}

it("inserts a session with and without a user agent", async () => {
  const { repository, execute } = repositoryOf();
  const base = { id: "s", userId: "u", tokenHash: "h", lifetimeDays: 7 };
  await repository.insert({ ...base, userAgent: "UA" });
  await repository.insert(base);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("INSERT INTO sessions"),
    expect.objectContaining({ user_agent: "UA", lifetime_days: 7 }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    expect.objectContaining({ user_agent: null }),
  );
});

it("finds the user id by token hash", async () => {
  await expect(
    repositoryOf([["u"]]).repository.findUserIdByTokenHash("h"),
  ).resolves.toBe("u");
  await expect(
    repositoryOf().repository.findUserIdByTokenHash("h"),
  ).resolves.toBeNull();
});

it("finds the session id by token hash", async () => {
  await expect(
    repositoryOf([["s"]]).repository.findIdByTokenHash("h"),
  ).resolves.toBe("s");
  await expect(
    repositoryOf().repository.findIdByTokenHash("h"),
  ).resolves.toBeNull();
});

it("tells whether a session is active", async () => {
  await expect(repositoryOf([[1]]).repository.isActive("s", "u")).resolves.toBe(
    true,
  );
  await expect(repositoryOf().repository.isActive("s", "u")).resolves.toBe(
    false,
  );
});

it("lists active sessions", async () => {
  const { repository } = repositoryOf([["s", "h", null, "c", "l", 1]]);
  await expect(repository.listActiveByUserId("u", "h")).resolves.toEqual([
    {
      id: "s",
      tokenHash: "h",
      userAgent: null,
      createdAt: "c",
      lastUsedAt: "l",
      isCurrent: true,
    },
  ]);
});

it("finds a token hash by session and user", async () => {
  await expect(
    repositoryOf([["h"]]).repository.findTokenHashByIdAndUserId("s", "u"),
  ).resolves.toBe("h");
  await expect(
    repositoryOf().repository.findTokenHashByIdAndUserId("s", "u"),
  ).resolves.toBeNull();
});

it("writes and deletes sessions", async () => {
  const { repository, execute } = repositoryOf();
  await repository.markUsed("h");
  await repository.deleteByIdAndUserId("s", "u");
  await repository.deleteAllExceptTokenHash("u", "h");
  await repository.deleteAllByUserId("u");
  await repository.deleteByTokenHash("h");
  await repository.deleteExpired();
  expect(execute).toHaveBeenCalledTimes(6);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM sessions"),
    { token_hash: "h", user_id: "u" },
  );
});
