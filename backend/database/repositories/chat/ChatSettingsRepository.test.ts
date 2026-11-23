import { expect, it, vi, type Mock } from "vitest";

import { ChatSettingsRepository } from "./ChatSettingsRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Database;
  readonly execute: Mock<Database["execute"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query } as unknown as Database, execute };
}

it("reads the stored system instruction", async () => {
  const { database } = databaseOf([["Be brief"]]);
  await expect(new ChatSettingsRepository(database).read()).resolves.toEqual({
    systemInstruction: "Be brief",
  });
});

it("reads the defaults when the settings row is missing", async () => {
  const { database } = databaseOf();
  await expect(new ChatSettingsRepository(database).read()).resolves.toEqual({
    systemInstruction: null,
  });
});

it("saves the system instruction", async () => {
  const { database, execute } = databaseOf();
  await new ChatSettingsRepository(database).save({ systemInstruction: "x" });
  expect(execute.mock.calls[0]?.[1]).toEqual({ system_instruction: "x" });
});
