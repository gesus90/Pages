import { expect, it, vi, type Mock } from "vitest";

import { ConversationAttachmentLibraryRepository } from "./ConversationAttachmentLibraryRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function libraryRow(
  overrides: Partial<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    "c1",
    "m1",
    "u1",
    "file.png",
    "image/png",
    10,
    "store-1",
    0,
    null,
    null,
    null,
    "2030-01-01",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "m1",
    "sender",
    BigInt(4),
    "sent",
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value as DatabaseValue;
  return row;
}

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationAttachmentLibraryRepository;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  return {
    repository: new ConversationAttachmentLibraryRepository({
      execute,
      query,
    }),
    execute,
    query,
  };
}

function parametersOf(mock: ReturnType<typeof vi.fn>, call = 0): unknown {
  return (mock.mock.calls[call] as unknown[])[1];
}

const REFERENCE_ROW: DatabaseValue[] = [
  "m9",
  1,
  "c1",
  "a1",
  "n",
  "image/png",
  "m1",
  "s1",
  "t",
];

it("lists the attachments of a conversation with their message", async () => {
  const { repository, query } = repositoryOf([
    libraryRow(),
    libraryRow({ 25: "2030-01-02" }),
  ]);
  const entries = await repository.attachments("c1");
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    messageId: "m1",
    senderId: "sender",
    sequence: 4,
    sentAt: "sent",
    hasText: false,
  });
  expect(entries[1]?.hasText).toBe(true);
  expect(parametersOf(query)).toEqual({ conversation_id: "c1" });
});

it("finds one attachment or null", async () => {
  await expect(
    repositoryOf().repository.attachment("c1", "a1"),
  ).resolves.toBeNull();
  const { repository, query } = repositoryOf([libraryRow()]);
  await expect(repository.attachment("c1", "a1")).resolves.toMatchObject({
    messageId: "m1",
  });
  expect(parametersOf(query)).toEqual({ conversation_id: "c1", id: "a1" });
});

it("lists voice messages with a default duration", async () => {
  const { repository } = repositoryOf([
    ["m1", "s", 2, "t", "text", "audio/ogg", 100, null, "done"],
    ["m2", "s", 1, "t", "", "audio/ogg", 50, 900, "pending"],
  ]);
  const voices = await repository.voices("c1");
  expect(voices[0]).toEqual({
    messageId: "m1",
    senderId: "s",
    sequence: 2,
    sentAt: "t",
    text: "text",
    mimeType: "audio/ogg",
    sizeBytes: 100,
    durationMs: 0,
    transcriptionState: "done",
  });
  expect(voices[1]?.durationMs).toBe(900);
});

it("reads stored texts by attachment", async () => {
  await expect(repositoryOf().repository.texts([])).resolves.toEqual(new Map());
  const { repository } = repositoryOf([["a1", "content"]]);
  await expect(repository.texts(["a1"])).resolves.toEqual(
    new Map([["a1", "content"]]),
  );
});

it("saves the recognized text", async () => {
  const { repository, execute } = repositoryOf();
  await repository.saveText("a1", "text", "t");
  expect(parametersOf(execute)).toEqual({
    attachment_id: "a1",
    content: "text",
    created_at: "t",
  });
});

it("inserts every reference in order", async () => {
  const { repository, execute } = repositoryOf();
  const reference = {
    messageId: "m9",
    position: 1,
    conversationId: "c1",
    attachmentId: "a1",
    name: "n",
    mimeType: "image/png",
    sourceMessageId: "m1",
    sourceSenderId: "s1",
    createdAt: "t",
  };
  await repository.insertReferences([reference, { ...reference, position: 2 }]);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(parametersOf(execute, 1)).toMatchObject({
    message_id: "m9",
    position: 2,
    source_sender_id: "s1",
  });
});

it("groups references by message", async () => {
  await expect(
    repositoryOf().repository.referencesForMessages([]),
  ).resolves.toEqual(new Map());
  const { repository } = repositoryOf([
    REFERENCE_ROW,
    [...REFERENCE_ROW.slice(0, 1), 2, ...REFERENCE_ROW.slice(2)],
    ["m10", ...REFERENCE_ROW.slice(1)],
  ]);
  const grouped = await repository.referencesForMessages(["m9", "m10"]);
  expect(grouped.get("m9")?.map((entry) => entry.position)).toEqual([1, 2]);
  expect(grouped.get("m10")).toHaveLength(1);
});

it("finds many attachments by id", async () => {
  await expect(repositoryOf().repository.findMany([])).resolves.toEqual(
    new Map(),
  );
  const { repository } = repositoryOf([libraryRow()]);
  const found = await repository.findMany(["a1"]);
  expect(found.get("a1")?.attachment.name).toBe("file.png");
});
