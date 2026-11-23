import { expect, it, vi, type Mock } from "vitest";

import { ChatViewPreferenceRepository } from "./ChatViewPreferenceRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: ChatViewPreferenceRepository;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  return {
    repository: new ChatViewPreferenceRepository({ execute, query }),
    execute,
    query,
  };
}

function parametersOf(mock: ReturnType<typeof vi.fn>): unknown {
  return (mock.mock.calls[0] as unknown[])[1];
}

it("reads the card states by key", async () => {
  const { repository, query } = repositoryOf([
    ["a", "collapsed"],
    ["b", "other"],
  ]);
  await expect(repository.cardStates("u")).resolves.toEqual({
    a: "collapsed",
    b: "expanded",
  });
  expect(parametersOf(query)).toEqual({ user_id: "u", limit: 2000 });
});

it("stores a card state", async () => {
  const { repository, execute } = repositoryOf();
  await repository.setCardState("u", {
    cardKey: "k",
    state: "collapsed",
    updatedAt: "t",
  });
  expect(parametersOf(execute)).toEqual({
    user_id: "u",
    card_key: "k",
    state: "collapsed",
    updated_at: "t",
  });
});

it("reads the split width or null", async () => {
  await expect(repositoryOf().repository.splitWidth("u")).resolves.toBeNull();
  await expect(
    repositoryOf([[null]]).repository.splitWidth("u"),
  ).resolves.toBeNull();
  await expect(
    repositoryOf([[undefined as unknown as null]]).repository.splitWidth("u"),
  ).resolves.toBeNull();
  await expect(repositoryOf([[320]]).repository.splitWidth("u")).resolves.toBe(
    320,
  );
});

it("reads whether the list is collapsed", async () => {
  await expect(repositoryOf().repository.isListCollapsed("u")).resolves.toBe(
    false,
  );
  await expect(
    repositoryOf([[1]]).repository.isListCollapsed("u"),
  ).resolves.toBe(true);
});

it("stores the list collapse as a number", async () => {
  const on = repositoryOf();
  await on.repository.setListCollapsed("u", true, "t");
  expect(parametersOf(on.execute)).toMatchObject({ list_collapsed: 1 });
  const off = repositoryOf();
  await off.repository.setListCollapsed("u", false, "t");
  expect(parametersOf(off.execute)).toMatchObject({ list_collapsed: 0 });
});

it("stores the split width", async () => {
  const { repository, execute } = repositoryOf();
  await repository.setSplitWidth("u", 300, "t");
  expect(parametersOf(execute)).toEqual({
    user_id: "u",
    split_width: 300,
    updated_at: "t",
  });
});

it("reads the last chat or null", async () => {
  await expect(repositoryOf().repository.lastChat("u")).resolves.toBeNull();
  await expect(
    repositoryOf([[null, null]]).repository.lastChat("u"),
  ).resolves.toBeNull();
  await expect(
    repositoryOf([[undefined as unknown as null]]).repository.lastChat("u"),
  ).resolves.toBeNull();
  await expect(
    repositoryOf([["bogus", "x"]]).repository.lastChat("u"),
  ).resolves.toBeNull();
  await expect(
    repositoryOf([["group", "g1"]]).repository.lastChat("u"),
  ).resolves.toEqual({ kind: "group", id: "g1" });
  await expect(
    repositoryOf([["participant", "p1"]]).repository.lastChat("u"),
  ).resolves.toEqual({ kind: "participant", id: "p1" });
});

it("stores the last chat", async () => {
  const { repository, execute } = repositoryOf();
  await repository.setLastChat("u", { kind: "group", id: "g" }, "t");
  expect(parametersOf(execute)).toEqual({
    user_id: "u",
    last_chat_kind: "group",
    last_chat_id: "g",
    updated_at: "t",
  });
});

it("reads the reading positions by chat key", async () => {
  const { repository, query } = repositoryOf([["c1", "m1"]]);
  await expect(repository.readingPositions("u")).resolves.toEqual({
    c1: "m1",
  });
  expect(parametersOf(query)).toEqual({ user_id: "u", limit: 500 });
});

it("stores and clears a reading position", async () => {
  const { repository, execute } = repositoryOf();
  await repository.setReadingPosition("u", {
    chatKey: "c",
    messageId: "m",
    updatedAt: "t",
  });
  expect(parametersOf(execute)).toEqual({
    user_id: "u",
    chat_key: "c",
    message_id: "m",
    updated_at: "t",
  });
  const cleared = repositoryOf();
  await cleared.repository.clearReadingPosition("u", "c");
  expect(parametersOf(cleared.execute)).toEqual({
    user_id: "u",
    chat_key: "c",
  });
});
