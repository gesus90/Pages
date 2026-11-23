import { expect, it, vi, type Mock } from "vitest";

import {
  ConversationMessageRepository,
  type NewConversationMessage,
} from "./ConversationMessageRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

type Cell = string | number | bigint | null;
type Rows = Cell[][];

const EVENT = { type: "conversation.message", id: "m1" };
const ANSWER = { answerId: "a1", durationMs: 5, tools: [] };

function messageRow(overrides: Record<number, Cell> = {}): Cell[] {
  const row: Cell[] = [
    "m1",
    4,
    "c1",
    "u1",
    "k1",
    "hello",
    '["u2",3]',
    "t",
    null,
    null,
    null,
    null,
    "pending",
    null,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

function databaseOf(...results: Rows[]): {
  readonly repository: ConversationMessageRepository;
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
    repository: new ConversationMessageRepository({ query, transaction }),
    execute,
    query,
  };
}

const NEW_MESSAGE: NewConversationMessage = {
  id: "m1",
  conversationId: "c1",
  senderId: "u1",
  clientMessageId: "k1",
  text: "hello",
  mentions: ["u2"],
  createdAt: "t",
  voice: null,
};

const STORED = {
  id: "m1",
  sequence: 4,
  conversationId: "c1",
  senderId: "u1",
  clientMessageId: "k1",
  text: "hello",
  mentions: ["u2"],
  createdAt: "t",
  voice: null,
  notice: null,
};

it("stores a new message, moves the activity and appends the event", async () => {
  const { repository, execute, query } = databaseOf([messageRow()]);
  await expect(repository.insert(NEW_MESSAGE, EVENT)).resolves.toEqual({
    message: STORED,
    isNew: true,
  });
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    voice_storage_name: null,
    notice: null,
    agent_answer: null,
    mentions: '["u2"]',
  });
  expect(execute).toHaveBeenCalledTimes(3);
});

it("stores the voice, notice and answer of a message", async () => {
  const { repository, query } = databaseOf([messageRow()]);
  await repository.insert(
    {
      ...NEW_MESSAGE,
      voice: {
        storageName: "s",
        mimeType: "audio/ogg",
        sizeBytes: 1,
        durationMs: 2,
        transcriptionState: "done",
      },
      notice: "agent_failed",
      agentAnswer: ANSWER,
    },
    EVENT,
  );
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    voice_storage_name: "s",
    voice_duration_ms: 2,
    transcription_state: "done",
    notice: "agent_failed",
    agent_answer: JSON.stringify(ANSWER),
  });
});

it("returns the stored message of a repeated client id", async () => {
  const { repository, execute } = databaseOf([], [messageRow()]);
  await expect(repository.insert(NEW_MESSAGE, EVENT)).resolves.toEqual({
    message: STORED,
    isNew: false,
  });
  expect(execute).not.toHaveBeenCalled();
});

it("fails when the repeated message is missing", async () => {
  const { repository } = databaseOf([], []);
  await expect(repository.insert(NEW_MESSAGE, EVENT)).rejects.toThrow(
    "The repeated message is missing.",
  );
});

it("reads voice, notice and the recorded answer of a row", async () => {
  const { repository } = databaseOf([
    messageRow({
      6: "{}",
      8: "s",
      9: "audio/ogg",
      10: 3n,
      11: 40,
      12: "done",
      13: "round_limit",
      14: JSON.stringify(ANSWER),
    }),
  ]);
  await expect(repository.find("c1", "m1")).resolves.toMatchObject({
    mentions: [],
    voice: {
      storageName: "s",
      mimeType: "audio/ogg",
      sizeBytes: 3,
      durationMs: 40,
      transcriptionState: "done",
    },
    notice: "round_limit",
    agentAnswer: ANSWER,
  });
});

it("reads a failed and an unknown transcription state", async () => {
  const failed = databaseOf([
    messageRow({ 8: "s", 9: "m", 10: 1, 11: 1, 12: "failed" }),
  ]);
  await expect(failed.repository.findById("m1")).resolves.toMatchObject({
    voice: { transcriptionState: "failed" },
  });
  const unknown = databaseOf([
    messageRow({ 8: "s", 9: "m", 10: 1, 11: 1, 12: "x", 13: "unknown" }),
  ]);
  await expect(unknown.repository.findById("m1")).resolves.toMatchObject({
    voice: { transcriptionState: "pending" },
    notice: null,
  });
});

it("finds a message or null", async () => {
  await expect(databaseOf().repository.find("c1", "m1")).resolves.toBeNull();
  await expect(databaseOf().repository.findById("m1")).resolves.toBeNull();
});

it("counts the context between two sequences", async () => {
  const { repository, query } = databaseOf([[6n]]);
  await expect(
    repository.contextCount("c1", { afterSequence: 1, throughSequence: 9 }),
  ).resolves.toBe(6);
  expect(query.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    after_sequence: 1,
    through_sequence: 9,
  });
});

it("rejects a context count without a row", async () => {
  await expect(
    databaseOf().repository.contextCount("c1", {
      afterSequence: 0,
      throughSequence: 1,
    }),
  ).rejects.toThrow("context_count");
});

it("tells whether an account wrote a message", async () => {
  await expect(databaseOf([[1]]).repository.hasSender("c", "u")).resolves.toBe(
    true,
  );
  await expect(databaseOf().repository.hasSender("c", "u")).resolves.toBe(
    false,
  );
});

it("reads the history and the content after a sequence", async () => {
  const history = databaseOf([messageRow()]);
  await expect(history.repository.history("c1", null, 5)).resolves.toEqual([
    STORED,
  ]);
  expect(history.query.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    before_sequence: null,
    limit: 5,
  });
  const content = databaseOf([messageRow()]);
  await expect(content.repository.contentAfter("c1", 2, 5)).resolves.toEqual([
    STORED,
  ]);
});

it("reads the newest message of each conversation", async () => {
  const { repository } = databaseOf([messageRow()]);
  await expect(repository.latest(["c1", "c2"])).resolves.toEqual(
    new Map([["c1", STORED]]),
  );
});

it("reads no latest messages without conversations", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.latest([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});

it("completes a transcription and appends the event", async () => {
  const { repository, execute, query } = databaseOf([messageRow()]);
  await expect(
    repository.completeTranscription(
      "m1",
      { state: "done", text: "hi", mentions: ["u2"] },
      EVENT,
    ),
  ).resolves.toEqual(STORED);
  expect(query.mock.calls[0]?.[1]).toMatchObject({ mentions: '["u2"]' });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("completes nothing for a message that no longer waits", async () => {
  const { repository, execute } = databaseOf([]);
  await expect(
    repository.completeTranscription(
      "m1",
      { state: "failed", text: "", mentions: [] },
      EVENT,
    ),
  ).resolves.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

it("removes a message of its sender", async () => {
  const hit = databaseOf([messageRow()]);
  await expect(
    hit.repository.remove({ id: "m1", senderId: "u1" }, EVENT),
  ).resolves.toEqual(STORED);
  expect(hit.execute).toHaveBeenCalledTimes(1);
  const miss = databaseOf([]);
  await expect(
    miss.repository.remove({ id: "m1", senderId: "u2" }, EVENT),
  ).resolves.toBeNull();
  expect(miss.execute).not.toHaveBeenCalled();
});

it("removes a failure notice only when one exists", async () => {
  const hit = databaseOf([["m1"]]);
  await expect(
    hit.repository.removeFailureNotice({ id: "m1", senderId: "a" }, EVENT),
  ).resolves.toBe(true);
  expect(hit.execute).toHaveBeenCalledTimes(1);
  const miss = databaseOf([]);
  await expect(
    miss.repository.removeFailureNotice({ id: "m1", senderId: "a" }, EVENT),
  ).resolves.toBe(false);
});

it("lists the voice storage names", async () => {
  const { repository } = databaseOf([["a"], ["b"]]);
  await expect(repository.voiceStorageNames()).resolves.toEqual(
    new Set(["a", "b"]),
  );
});
