import { expect, it, vi, type Mock } from "vitest";

import { ConversationRepository } from "./ConversationRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

type Rows = (string | number | bigint | null)[][];

const EVENT = { type: "conversation.changed", id: "c1" };

const NEW_CONVERSATION = {
  id: "c1",
  kind: "group",
  name: "Team",
  directKey: null,
  createdBy: "u1",
  createdAt: "t",
  memberIds: ["u1", "u2"],
} as const;

function databaseOf(...results: Rows[]): {
  readonly repository: ConversationRepository;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => []);
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const transaction = vi.fn(
    async (work: (transaction: DatabaseTransaction) => Promise<unknown>) =>
      work({ execute, query }),
  ) as unknown as Database["transaction"];
  return {
    repository: new ConversationRepository({ execute, query, transaction }),
    execute,
    query,
  };
}

function outboxKinds(execute: Mock<DatabaseTransaction["execute"]>): unknown[] {
  return execute.mock.calls
    .map((call) => call[1])
    .filter((parameters) => parameters && "kind" in parameters);
}

it("creates a conversation with its members and event", async () => {
  const { repository, execute } = databaseOf([["c1"]]);
  await expect(repository.create(NEW_CONVERSATION, EVENT)).resolves.toEqual({
    id: "c1",
    isNew: true,
  });
  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    user_id: "u1",
    joined_at: "t",
  });
  expect(outboxKinds(execute)).toHaveLength(1);
});

it("returns the first direct conversation of a pair", async () => {
  const { repository, execute } = databaseOf([], [["first"]]);
  await expect(
    repository.create(
      { ...NEW_CONVERSATION, kind: "direct", directKey: "u1:u2" },
      EVENT,
    ),
  ).resolves.toEqual({ id: "first", isNew: false });
  expect(execute).not.toHaveBeenCalled();
});

it("fails when the stored direct conversation vanished", async () => {
  const none = databaseOf([], []);
  await expect(
    none.repository.create({ ...NEW_CONVERSATION, directKey: "k" }, EVENT),
  ).rejects.toThrow("The direct conversation of the pair is missing.");
  const nullId = databaseOf([], [[null]]);
  await expect(
    nullId.repository.create({ ...NEW_CONVERSATION, directKey: "k" }, EVENT),
  ).rejects.toThrow("The direct conversation of the pair is missing.");
});

it("tells whether a conversation exists", async () => {
  await expect(databaseOf([["c"]]).repository.exists("c")).resolves.toBe(true);
  await expect(databaseOf().repository.exists("c")).resolves.toBe(false);
});

it("reads the creator or null", async () => {
  await expect(databaseOf([["u1"]]).repository.createdBy("c")).resolves.toBe(
    "u1",
  );
  await expect(databaseOf().repository.createdBy("c")).resolves.toBeNull();
});

it("finds a direct conversation or null", async () => {
  await expect(databaseOf([["c"]]).repository.findDirect("k")).resolves.toBe(
    "c",
  );
  await expect(databaseOf().repository.findDirect("k")).resolves.toBeNull();
});

it("adds members and appends the event", async () => {
  const { repository, execute } = databaseOf();
  await repository.addMembers("c1", { ids: ["u3"], joinedAt: "j" }, EVENT);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ user_id: "u3" });
});

it("removes a member and appends the event", async () => {
  const { repository, execute } = databaseOf();
  await repository.removeMember("c1", "u2", EVENT);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    user_id: "u2",
  });
  expect(outboxKinds(execute)).toHaveLength(1);
});

it("removes a conversation and returns its voice storage names", async () => {
  const { repository, execute } = databaseOf([["v1"], ["v2"]]);
  await expect(repository.remove("c1", EVENT)).resolves.toEqual(["v1", "v2"]);
  expect(execute).toHaveBeenCalledTimes(2);
});

const ROW = ["c1", "group", "Team", "t", 1, 3];
const RECORD = {
  id: "c1",
  kind: "group",
  name: "Team",
  lastActivityAt: "t",
  isMuted: true,
  unreadCount: 3,
};

it("finds a conversation for a member or null", async () => {
  await expect(
    databaseOf([ROW]).repository.findForMember("c1", "u1"),
  ).resolves.toEqual(RECORD);
  await expect(
    databaseOf().repository.findForMember("c1", "u1"),
  ).resolves.toBeNull();
});

it("reads any other kind as a direct conversation", async () => {
  const record = await databaseOf([
    ["c2", "other", "N", "t", 0, 0n],
  ]).repository.findForMember("c2", "u1");
  expect(record).toMatchObject({ kind: "direct", isMuted: false });
});

it("lists the first page without a position", async () => {
  const { repository, query } = databaseOf([ROW]);
  await expect(repository.listForMember("u1", null, 5)).resolves.toEqual([
    RECORD,
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    after_activity: null,
    after_id: null,
    limit: 5,
  });
});

it("lists the next page after a position", async () => {
  const { repository, query } = databaseOf([]);
  await repository.listForMember("u1", { lastActivityAt: "a", id: "i" }, 5);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    after_activity: "a",
    after_id: "i",
  });
});

it("sums the unread messages", async () => {
  await expect(databaseOf([[4]]).repository.totalUnread("u1")).resolves.toBe(4);
  await expect(databaseOf().repository.totalUnread("u1")).resolves.toBe(0);
});

it("groups member ids by conversation", async () => {
  const { repository } = databaseOf([
    ["a", "u1"],
    ["a", "u2"],
    ["b", "u3"],
  ]);
  await expect(repository.memberIds(["a", "b"])).resolves.toEqual(
    new Map([
      ["a", ["u1", "u2"]],
      ["b", ["u3"]],
    ]),
  );
});

it("reads no members without conversations", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.memberIds([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});

it("reads the members that muted a conversation", async () => {
  await expect(
    databaseOf([["u1"], ["u2"]]).repository.mutedMemberIds("c"),
  ).resolves.toEqual(new Set(["u1", "u2"]));
});

it("sets the muted flag", async () => {
  const { repository, execute } = databaseOf();
  await repository.setMuted("c", "u", true);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c",
    user_id: "u",
    is_muted: true,
  });
});

it("marks a conversation read up to a sequence", async () => {
  const { repository, execute } = databaseOf();
  await repository.markRead("c", "u", 9);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c",
    user_id: "u",
    sequence: 9,
  });
});
