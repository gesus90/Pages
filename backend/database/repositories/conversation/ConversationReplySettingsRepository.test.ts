import { expect, it, vi, type Mock } from "vitest";

import { ConversationReplySettingsRepository } from "./ConversationReplySettingsRepository";

import type { Database } from "@/backend/database/Database";

type Rows = (string | number | bigint | null)[][];

function databaseOf(rows: Rows = []): {
  readonly database: Pick<Database, "execute" | "query">;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("returns the defaults of a group without a stored row", async () => {
  const { database } = databaseOf();
  await expect(
    new ConversationReplySettingsRepository(database).find("c1"),
  ).resolves.toMatchObject({
    conversationId: "c1",
    mode: "decision",
    automaticRepliesPerOrigin: 8,
  });
});

it("reads stored settings with their overrides", async () => {
  const { database } = databaseOf([["mentions", 1, 2n, null, 4, 3]]);
  await expect(
    new ConversationReplySettingsRepository(database).find("c1"),
  ).resolves.toEqual({
    conversationId: "c1",
    mode: "mentions",
    overrides: {
      answerThreshold: 1,
      responsibilityThreshold: 2,
      secondThreshold: null,
      maximumResponders: 4,
    },
    automaticRepliesPerOrigin: 3,
  });
});

it("falls back to the default mode for an unknown stored mode", async () => {
  const { database } = databaseOf([["weird", null, null, null, null, 1]]);
  const settings = await new ConversationReplySettingsRepository(database).find(
    "c1",
  );
  expect(settings.mode).toBe("decision");
});

it("reads no modes without asking for groups", async () => {
  const { database, query } = databaseOf();
  const modes = await new ConversationReplySettingsRepository(database).modes(
    [],
  );
  expect(modes.size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("maps the modes of several groups", async () => {
  const { database } = databaseOf([
    ["a", "mentions"],
    ["b", "other"],
  ]);
  const modes = await new ConversationReplySettingsRepository(database).modes([
    "a",
    "b",
    "c",
  ]);
  expect([...modes]).toEqual([
    ["a", "mentions"],
    ["b", "decision"],
  ]);
});

it("saves the settings with clamped round limits", async () => {
  const { database, execute } = databaseOf();
  await new ConversationReplySettingsRepository(database).save({
    settings: {
      conversationId: "c1",
      mode: "mentions",
      overrides: {
        answerThreshold: 1,
        responsibilityThreshold: null,
        secondThreshold: 3,
        maximumResponders: null,
      },
      automaticRepliesPerOrigin: 99,
    },
    updatedBy: "u1",
    updatedAt: "now",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    mode: "mentions",
    answer_threshold: 1,
    responsibility_threshold: null,
    second_threshold: 3,
    max_responders: null,
    replies_per_round: 9,
    updated_by: "u1",
    updated_at: "now",
  });
});
