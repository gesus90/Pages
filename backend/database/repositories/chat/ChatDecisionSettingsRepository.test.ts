import { expect, it, vi, type Mock } from "vitest";

import { ChatDecisionSettingsRepository } from "./ChatDecisionSettingsRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { ChatDecisionSettings } from "@/definition/ConversationDecision";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: Pick<Database, "query">;
  readonly query: Mock<Database["query"]>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { query }, query };
}

const RULES = {
  answerThreshold: 1,
  responsibilityThreshold: 2,
  secondThreshold: 3,
  maximumResponders: 4,
};

it("reads the selection and the rules", async () => {
  const { database } = databaseOf([["c1", "m", "low", 7, 1, 2, 3, 4]]);
  await expect(
    new ChatDecisionSettingsRepository(database).read(),
  ).resolves.toEqual({
    selection: { connectionId: "c1", model: "m", reasoningEffort: "low" },
    rules: RULES,
    revision: 7,
  });
});

it("reads no selection when the connection or the model is missing", async () => {
  for (const row of [
    [null, "m", null, 0, 1, 2, 3, 4],
    ["c1", null, null, 0, 1, 2, 3, 4],
  ]) {
    const { database } = databaseOf([row]);
    await expect(
      new ChatDecisionSettingsRepository(database).read(),
    ).resolves.toMatchObject({ selection: null, rules: RULES });
  }
});

it("rejects a missing settings row", async () => {
  const { database } = databaseOf([]);
  await expect(
    new ChatDecisionSettingsRepository(database).read(),
  ).rejects.toMatchObject({ code: "profile_invalid" });
});

it("saves a selection with the revision it was read at", async () => {
  const { database, query } = databaseOf([["1"]]);
  const settings: ChatDecisionSettings = {
    selection: { connectionId: "c1", model: "m", reasoningEffort: "low" },
    rules: RULES,
    revision: 5,
  };
  await new ChatDecisionSettingsRepository(database).save(settings);
  expect(query.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    model: "m",
    reasoning_effort: "low",
    answer_threshold: 1,
    responsibility_threshold: 2,
    second_threshold: 3,
    max_responders: 4,
    revision: 5,
  });
});

it("saves an empty selection as null columns", async () => {
  const { database, query } = databaseOf([["1"]]);
  await new ChatDecisionSettingsRepository(database).save({
    selection: null,
    rules: RULES,
    revision: 0,
  });
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    connection_id: null,
    model: null,
    reasoning_effort: null,
  });
});

it("rejects a save on a changed revision", async () => {
  const { database } = databaseOf([]);
  await expect(
    new ChatDecisionSettingsRepository(database).save({
      selection: null,
      rules: RULES,
      revision: 0,
    }),
  ).rejects.toMatchObject({ code: "profile_conflict" });
});
