import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

import {
  hasCommittedSetup,
  initializeSetupDatabase,
  renewSetupSession,
  SetupDatabaseNotEmptyError,
} from "@/backend/setup/SetupPostgresRepository";

import { partial } from "../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

const RECORD = {
  companyName: "Company",
  username: "admin",
  email: null,
  passwordHash: "synthetic",
  language: "en" as const,
  userAgent: null,
};

it("initializes an empty schema with ordered migrations and a hashed session", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[0]]);
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = { query, execute };
  const database = partial<Database>({
    transaction: async (
      work: (scope: DatabaseTransaction) => Promise<string>,
    ) => work(transaction),
  });
  await expect(
    initializeSetupDatabase(
      database,
      [
        { name: "002.sql", sql: "second" },
        { name: "001.sql", sql: "first" },
      ],
      RECORD,
      "token",
    ),
  ).resolves.toBe("token");
  const statements = execute.mock.calls.map(([sql]) => sql);
  expect(statements.indexOf("first")).toBeLessThan(
    statements.indexOf("second"),
  );
  const session = execute.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO sessions"),
  );
  expect(session?.[1]).toMatchObject({
    token_hash: createHash("sha256").update("token").digest("hex"),
    user_agent: null,
  });
});

it("refuses initialization of a nonempty schema before migrations", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[1]]);
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = { query, execute };
  const database = partial<Database>({
    transaction: async (
      work: (scope: DatabaseTransaction) => Promise<string>,
    ) => work(transaction),
  });
  await expect(
    initializeSetupDatabase(
      database,
      [{ name: "001", sql: "migration" }],
      RECORD,
      "token",
    ),
  ).rejects.toBeInstanceOf(SetupDatabaseNotEmptyError);
  expect(execute.mock.calls.some(([sql]) => sql === "migration")).toBe(false);
});

it("checks and renews a committed setup by token hash", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([[null]])
    .mockResolvedValueOnce([["sessions"]])
    .mockResolvedValueOnce([["user"]]);
  const execute = vi.fn<Database["execute"]>().mockResolvedValue(undefined);
  const database = partial<Database>({ query, execute });
  await expect(hasCommittedSetup(database, "token")).resolves.toBe(false);
  await expect(hasCommittedSetup(database, "token")).resolves.toBe(true);
  await renewSetupSession(database, "token");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    token_hash: createHash("sha256").update("token").digest("hex"),
  });
});
