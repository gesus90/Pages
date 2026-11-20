import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import {
  hasCommittedSetup,
  initializeSetupDatabase,
  renewSetupSession,
  SetupDatabaseNotEmptyError,
} from "./SetupPostgresRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { SetupRecord } from "./SetupDatabaseWriter";

const provision = vi.hoisted(() => vi.fn());
vi.mock("@/backend/database/repositories/LegacyAccountProvisioning", () => ({
  provisionAccount: provision,
}));

const record: SetupRecord = {
  companyName: "Example",
  username: "admin",
  email: null,
  passwordHash: "hash",
  language: "en",
  userAgent: null,
};

it("initializes an empty database atomically with ordered migrations and a hashed session", async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[0]]);
  const transaction: DatabaseTransaction = { execute, query };
  const database = {
    transaction: async <Result>(
      work: (tx: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  };
  const migrations = [
    { name: "b", sql: "second" },
    { name: "a", sql: "first" },
  ];
  expect(
    await initializeSetupDatabase(database, migrations, record, "token"),
  ).toBe("token");
  const statements = execute.mock.calls.map((call) => call[0]);
  expect(statements.indexOf("first")).toBeLessThan(
    statements.indexOf("second"),
  );
  expect(provision).toHaveBeenCalledWith(
    transaction,
    expect.objectContaining({ username: "admin" }),
  );
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO sessions"),
    expect.objectContaining({
      token_hash: createHash("sha256").update("token").digest("hex"),
    }),
  );
});

it("refuses an occupied or indeterminate schema before migration", async () => {
  for (const rows of [[[1]], []]) {
    const execute = vi.fn();
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
    const transaction: DatabaseTransaction = { execute, query };
    const database = {
      transaction: async <Result>(
        work: (tx: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => work(transaction),
    };
    await expect(
      initializeSetupDatabase(database, [], record, "token"),
    ).rejects.toBeInstanceOf(SetupDatabaseNotEmptyError);
    expect(execute).toHaveBeenCalledTimes(2);
  }
});

it("checks the session table and renews only the matching token", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[null]])
    .mockResolvedValueOnce([["sessions"]])
    .mockResolvedValueOnce([["user"]])
    .mockResolvedValueOnce([["sessions"]])
    .mockResolvedValueOnce([]);
  expect(await hasCommittedSetup({ query }, "token")).toBe(false);
  expect(await hasCommittedSetup({ query }, "token")).toBe(true);
  expect(await hasCommittedSetup({ query }, "token")).toBe(false);
  const execute = vi.fn().mockResolvedValue(undefined);
  await renewSetupSession({ execute }, "token");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE sessions"),
    expect.objectContaining({
      token_hash: createHash("sha256").update("token").digest("hex"),
    }),
  );
});
