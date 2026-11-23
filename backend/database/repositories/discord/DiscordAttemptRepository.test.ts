import { expect, it, vi } from "vitest";

import { DiscordAttemptRepository } from "./DiscordAttemptRepository";

import type { DiscordDatabase } from "./DiscordDatabase";

function doubleOf(rows: unknown[][] = []): {
  repository: DiscordAttemptRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const transaction = vi.fn(
    async (work: (inner: unknown) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    repository: new DiscordAttemptRepository({
      query,
      execute,
      transaction,
    } as unknown as DiscordDatabase),
    query,
    execute,
  };
}

function attemptRow(
  overrides: Partial<Record<number, string | null>> = {},
): unknown[] {
  const row: unknown[] = [
    "a1",
    "hash",
    "p1",
    "u1",
    "https://pages.test",
    "pending",
    null,
    null,
    null,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:10:00Z",
    null,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  return row;
}

const EXPECTED = {
  id: "a1",
  stateHash: "hash",
  projectId: "p1",
  userId: "u1",
  baseUrl: "https://pages.test",
  status: "pending",
  failure: null,
  guildId: null,
  guildName: null,
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-01-01T00:10:00Z",
  consumedAt: null,
};

it("cancels open attempts and inserts the new one in one transaction", async () => {
  const { repository, execute } = doubleOf();

  await repository.insertAttempt({
    id: "a1",
    stateHash: "hash",
    projectId: "p1",
    userId: "u1",
    baseUrl: "https://pages.test",
    createdAt: "c",
    expiresAt: "e",
  });

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    project_id: "p1",
    user_id: "u1",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    id: "a1",
    state_hash: "hash",
    expires_at: "e",
  });
});

it("maps found attempts and returns null without a row", async () => {
  const { repository, query } = doubleOf([attemptRow()]);

  await expect(repository.findAttempt("a1")).resolves.toEqual(EXPECTED);
  await expect(repository.findAttemptByStateHash("hash")).resolves.toEqual(
    EXPECTED,
  );
  await expect(repository.findLatestAttempt("p1", "u1")).resolves.toEqual(
    EXPECTED,
  );
  await expect(repository.claimByStateHash("hash", "now")).resolves.toEqual(
    EXPECTED,
  );
  expect(query.mock.calls[3]?.[1]).toEqual({ now: "now", state_hash: "hash" });

  const empty = doubleOf();
  await expect(empty.repository.findAttempt("x")).resolves.toBeNull();
  await expect(
    empty.repository.findAttemptByStateHash("x"),
  ).resolves.toBeNull();
  await expect(
    empty.repository.findLatestAttempt("p", "u"),
  ).resolves.toBeNull();
  await expect(empty.repository.claimByStateHash("x", "n")).resolves.toBeNull();
});

it("maps failures, unknown failures and rejects an invalid status", async () => {
  const known = doubleOf([attemptRow({ 6: "denied", 11: "t" })]);
  await expect(known.repository.findAttempt("a1")).resolves.toMatchObject({
    failure: "denied",
    consumedAt: "t",
  });

  const unknown = doubleOf([attemptRow({ 6: "other" })]);
  await expect(unknown.repository.findAttempt("a1")).resolves.toMatchObject({
    failure: null,
  });

  const invalid = doubleOf([attemptRow({ 5: "bogus" })]);
  await expect(invalid.repository.findAttempt("a1")).rejects.toThrow(
    'invalid value for "status"',
  );
});

it("reports whether the guarded updates changed a row", async () => {
  const hit = doubleOf([["a1"]]);
  await expect(
    hit.repository.recordAuthorization("a1", { id: "g", name: "G" }),
  ).resolves.toBe(true);
  await expect(hit.repository.recordFailure("a1", "denied")).resolves.toBe(
    true,
  );
  await expect(hit.repository.confirm("a1", "now")).resolves.toBe(true);
  expect(hit.query.mock.calls[0]?.[1]).toEqual({
    guild_id: "g",
    guild_name: "G",
    id: "a1",
  });

  const miss = doubleOf();
  await expect(
    miss.repository.recordAuthorization("a1", { id: "g", name: "G" }),
  ).resolves.toBe(false);
  await expect(miss.repository.recordFailure("a1", "denied")).resolves.toBe(
    false,
  );
  await expect(miss.repository.confirm("a1", "now")).resolves.toBe(false);
});

it("cancels an attempt and deletes expired ones", async () => {
  const { repository, execute } = doubleOf();

  await repository.cancel("a1");
  await repository.deleteExpired("before");

  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "a1" });
  expect(execute.mock.calls[1]?.[1]).toEqual({ before: "before" });
});
