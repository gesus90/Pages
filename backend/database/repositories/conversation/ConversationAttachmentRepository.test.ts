import { expect, it, vi, type Mock } from "vitest";

import { ConversationAttachmentRepository } from "./ConversationAttachmentRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function attachmentRow(
  overrides: Partial<Record<number, DatabaseValue>> = {},
  extra: DatabaseValue[] = [],
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    "c1",
    "m1",
    "u1",
    "file.png",
    "image/png",
    BigInt(10),
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
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value as DatabaseValue;
  return [...row, ...extra];
}

function repositoryOf(
  rows: DatabaseValue[][] = [],
  transactionQuery: Mock = vi.fn(async () => [["a1"]]),
): {
  readonly repository: ConversationAttachmentRepository;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  const repository = new ConversationAttachmentRepository({
    execute,
    query,
    transaction: async (work) => work({ query: transactionQuery, execute }),
  });
  return { repository, execute, query };
}

function parametersOf(mock: ReturnType<typeof vi.fn>): unknown {
  return (mock.mock.calls[0] as unknown[])[1];
}

const BASE = {
  id: "a1",
  conversationId: "c1",
  messageId: "m1",
  uploaderId: "u1",
  name: "file.png",
  mimeType: "image/png",
  sizeBytes: 10,
  storageName: "store-1",
  position: 0,
  thumbnail: null,
  createdAt: "2030-01-01",
  expiresAt: null,
  expiredAt: null,
  media: null,
  sha256: null,
  document: null,
};

it("inserts an attachment with defaults for optional values", async () => {
  const { repository, execute } = repositoryOf();
  await repository.insert({
    id: "a1",
    conversationId: "c1",
    messageId: null,
    uploaderId: "u1",
    name: "n",
    mimeType: "m",
    sizeBytes: 1,
    storageName: "s",
    createdAt: "t",
  });
  expect(parametersOf(execute)).toMatchObject({
    position: 0,
    expires_at: null,
    sha256: null,
  });
  const full = repositoryOf();
  await full.repository.insert({
    id: "a1",
    conversationId: "c1",
    messageId: "m",
    uploaderId: "u1",
    name: "n",
    mimeType: "m",
    sizeBytes: 1,
    storageName: "s",
    createdAt: "t",
    position: 2,
    expiresAt: "e",
    sha256: "h",
  });
  expect(parametersOf(full.execute)).toMatchObject({
    position: 2,
    expires_at: "e",
    sha256: "h",
  });
});

it("finds an attachment or null", async () => {
  await expect(repositoryOf().repository.find("a1")).resolves.toBeNull();
  await expect(
    repositoryOf([attachmentRow()]).repository.find("a1"),
  ).resolves.toEqual(BASE);
});

it("reads thumbnail, media and document facts", async () => {
  const row = attachmentRow({
    9: "thumb",
    10: "image/jpeg",
    11: 5,
    13: "e",
    14: "x",
    15: 640,
    16: 480,
    17: 1000,
    18: "hash",
    19: 3,
    20: "Title",
  });
  await expect(repositoryOf([row]).repository.find("a1")).resolves.toEqual({
    ...BASE,
    thumbnail: { storageName: "thumb", mimeType: "image/jpeg", sizeBytes: 5 },
    expiresAt: "e",
    expiredAt: "x",
    media: { width: 640, height: 480, durationMs: 1000 },
    sha256: "hash",
    document: { pageCount: 3, title: "Title" },
  });
  const partial = attachmentRow({ 20: "Only title" });
  await expect(
    repositoryOf([partial]).repository.find("a1"),
  ).resolves.toMatchObject({
    document: { pageCount: null, title: "Only title" },
  });
});

it("groups the attachments of messages and skips unbound ones", async () => {
  const { repository, query } = repositoryOf([
    attachmentRow(),
    attachmentRow({ 0: "a2", 8: 1 }),
    attachmentRow({ 0: "a3", 2: "m2" }),
    attachmentRow({ 0: "a4", 2: null }),
  ]);
  const grouped = await repository.forMessages(["m1", "m2"]);
  expect([...grouped.keys()]).toEqual(["m1", "m2"]);
  expect(grouped.get("m1")?.map((entry) => entry.id)).toEqual(["a1", "a2"]);
  expect(Object.values(parametersOf(query) as object)).toEqual(["m1", "m2"]);
  await expect(repositoryOf().repository.forMessages([])).resolves.toEqual(
    new Map(),
  );
});

it("lists every attachment of a conversation", async () => {
  const { repository, query } = repositoryOf([attachmentRow()]);
  await expect(repository.forConversation("c1")).resolves.toEqual([BASE]);
  expect(parametersOf(query)).toEqual({ conversation_id: "c1" });
});

it("binds attachments in order inside one transaction", async () => {
  const transactionQuery = vi.fn(async () => [["a"]]);
  const { repository } = repositoryOf([], transactionQuery);
  const message = { id: "m", conversationId: "c", senderId: "s" };
  await expect(repository.bind(message, ["x", "y"])).resolves.toBe(true);
  expect(transactionQuery).toHaveBeenCalledTimes(2);
  expect(transactionQuery.mock.calls[1]).toHaveProperty(
    "1",
    expect.objectContaining({ id: "y", position: 1, message_id: "m" }),
  );
  await expect(repositoryOf().repository.bind(message, [])).resolves.toBe(true);
});

it("reports false when an attachment cannot be bound", async () => {
  const { repository } = repositoryOf(
    [],
    vi.fn(async () => []),
  );
  await expect(
    repository.bind({ id: "m", conversationId: "c", senderId: "s" }, ["x"]),
  ).resolves.toBe(false);
});

it("rethrows other errors while binding", async () => {
  const { repository } = repositoryOf(
    [],
    vi.fn(async () => {
      throw new Error("boom");
    }),
  );
  await expect(
    repository.bind({ id: "m", conversationId: "c", senderId: "s" }, ["x"]),
  ).rejects.toThrow("boom");
});

it("reports whether a thumbnail, media or document facts were set", async () => {
  const thumbnail = { storageName: "s", mimeType: "m", sizeBytes: 1 };
  await expect(
    repositoryOf([["a1"]]).repository.setThumbnail("a1", thumbnail),
  ).resolves.toBe(true);
  await expect(
    repositoryOf().repository.setThumbnail("a1", thumbnail),
  ).resolves.toBe(false);
  const media = { width: 1, height: 2, durationMs: null };
  await expect(
    repositoryOf([["a1"]]).repository.setMediaFacts("a1", media),
  ).resolves.toBe(true);
  await expect(
    repositoryOf().repository.setMediaFacts("a1", media),
  ).resolves.toBe(false);
  const document = { pageCount: 2, title: null };
  await expect(
    repositoryOf([["a1"]]).repository.setDocumentFacts("a1", document),
  ).resolves.toBe(true);
  await expect(
    repositoryOf().repository.setDocumentFacts("a1", document),
  ).resolves.toBe(false);
});

it("removes an unbound attachment and returns it", async () => {
  await expect(
    repositoryOf().repository.removeUnbound("a1", "u1"),
  ).resolves.toBeNull();
  const { repository, query } = repositoryOf([attachmentRow()]);
  await expect(repository.removeUnbound("a1", "u1")).resolves.toEqual(BASE);
  expect(parametersOf(query)).toEqual({ id: "a1", uploader_id: "u1" });
});

it("removes the unbound attachments before a moment", async () => {
  const { repository, query } = repositoryOf([attachmentRow()]);
  await expect(repository.removeUnboundBefore("t")).resolves.toEqual([BASE]);
  expect(parametersOf(query)).toEqual({ created_before: "t" });
});

it("expires due attachments and returns their file names", async () => {
  const { repository, query } = repositoryOf([
    ["file-1", "thumb-1"],
    ["file-2", null],
  ]);
  await expect(repository.expireDue("d", "e")).resolves.toEqual([
    "file-1",
    "thumb-1",
    "file-2",
  ]);
  expect(parametersOf(query)).toEqual({ due_before: "d", expired_at: "e" });
});

it("lists images and videos of a conversation with their message", async () => {
  const { repository, query } = repositoryOf([
    attachmentRow({}, ["sender", "sent"]),
    attachmentRow({ 2: null }, ["sender", "sent"]),
  ]);
  const images = await repository.imagesOfConversation("c1");
  expect(images).toEqual([
    { attachment: BASE, messageId: "m1", senderId: "sender", sentAt: "sent" },
  ]);
  expect(parametersOf(query)).toEqual({
    conversation_id: "c1",
    type_pattern: "image/%",
  });
  const videos = repositoryOf();
  await videos.repository.mediaOfConversation("c1", "video");
  expect(parametersOf(videos.query)).toMatchObject({
    type_pattern: "video/%",
  });
});

it("lists the file names of attachments that did not expire", async () => {
  const { repository } = repositoryOf([
    ["file-1", "thumb-1"],
    ["file-2", null],
  ]);
  await expect(repository.storageNames()).resolves.toEqual(
    new Set(["file-1", "thumb-1", "file-2"]),
  );
});
