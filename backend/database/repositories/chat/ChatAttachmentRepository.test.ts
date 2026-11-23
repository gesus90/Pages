import { expect, it, vi, type Mock } from "vitest";

import { ChatAttachmentRepository } from "./ChatAttachmentRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: Database;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const transaction = vi.fn(
    async (work: (inner: DatabaseTransaction) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    database: { query, execute, transaction } as unknown as Database,
    query,
    execute,
  };
}

function row(
  id: string,
  fileName = "f.txt",
  extra: DatabaseValue[] = [null, null],
): DatabaseValue[] {
  return [id, "s1", null, fileName, "text/plain", 3, `st-${id}`, ...extra];
}

const UPLOAD = {
  sessionId: "s1",
  fileName: "f.txt",
  contentType: "text/plain",
  size: 3,
  storageName: "st",
};

it("stores an upload", async () => {
  const { database, query } = databaseOf([row("a1", "f.txt", ["user", null])]);
  await expect(
    new ChatAttachmentRepository(database).insertUpload("u1", UPLOAD, 5),
  ).resolves.toEqual({
    kind: "stored",
    attachment: {
      id: "a1",
      sessionId: "s1",
      messageId: null,
      fileName: "f.txt",
      contentType: "text/plain",
      size: 3,
      storageName: "st-a1",
    },
  });
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    session_id: "s1",
    user_id: "u1",
    limit: 5,
  });
});

it("tells a full message from a missing session", async () => {
  const full = databaseOf([], [["s1"]]);
  await expect(
    new ChatAttachmentRepository(full.database).insertUpload("u1", UPLOAD, 1),
  ).resolves.toEqual({ kind: "full" });
  const missing = databaseOf([], []);
  await expect(
    new ChatAttachmentRepository(missing.database).insertUpload(
      "u1",
      UPLOAD,
      1,
    ),
  ).resolves.toEqual({ kind: "sessionMissing" });
});

it("stores an answer file of a run, or returns null", async () => {
  const stored = databaseOf([row("a1", "f.txt", ["assistant", "r1"])]);
  await expect(
    new ChatAttachmentRepository(stored.database).insertAnswerFile("u1", {
      ...UPLOAD,
      runId: "r1",
    }),
  ).resolves.toMatchObject({ origin: "assistant", runId: "r1" });
  expect(stored.query.mock.calls[0]?.[1]).toMatchObject({ pica_run_id: "r1" });
  const missing = databaseOf([]);
  await expect(
    new ChatAttachmentRepository(missing.database).insertAnswerFile("u1", {
      ...UPLOAD,
      runId: "r1",
    }),
  ).resolves.toBeNull();
});

it("lists the unclaimed answer files of a run", async () => {
  const { database } = databaseOf([row("a1")]);
  await expect(
    new ChatAttachmentRepository(database).answerFiles("s1", "r1"),
  ).resolves.toHaveLength(1);
});

it("claims the answer files sorted by name, then creation order", async () => {
  const { database } = databaseOf([
    [...row("c"), 3],
    [...row("b", "a.txt"), 2],
    [...row("a", "a.txt"), 1],
  ]);
  const files = await new ChatAttachmentRepository(database).claimAnswerFiles(
    "s1",
    "r1",
    "m1",
  );
  expect(files.map((file) => file.id)).toEqual(["a", "b", "c"]);
});

it("removes unclaimed answer files in creation order", async () => {
  const { database, query } = databaseOf([
    ["b", 2],
    ["a", 1],
  ]);
  await expect(
    new ChatAttachmentRepository(database).removeUnclaimedAnswerFiles(
      null,
      null,
    ),
  ).resolves.toEqual(["a", "b"]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    session_id: null,
    pica_run_id: null,
  });
});

it("removes one unclaimed file with its stored bytes", async () => {
  const { database, execute } = databaseOf([["st"]]);
  const remove = vi.fn(async () => {});
  await new ChatAttachmentRepository(database).removeUnclaimedAnswerFile(
    "s1",
    null,
    "a1",
    remove,
  );
  expect(remove).toHaveBeenCalledWith("st");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("keeps everything when the unclaimed file is gone", async () => {
  const { database, execute } = databaseOf([]);
  const remove = vi.fn(async () => {});
  await new ChatAttachmentRepository(database).removeUnclaimedAnswerFile(
    "s1",
    "r1",
    "a1",
    remove,
  );
  expect(remove).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it("finds an own attachment or returns null", async () => {
  const found = databaseOf([row("a1")]);
  await expect(
    new ChatAttachmentRepository(found.database).find("u1", "a1"),
  ).resolves.toMatchObject({ id: "a1" });
  const missing = databaseOf([]);
  await expect(
    new ChatAttachmentRepository(missing.database).find("u1", "a1"),
  ).resolves.toBeNull();
});

it("lists the attachments of a session", async () => {
  const { database } = databaseOf([row("a1"), row("a2")]);
  await expect(
    new ChatAttachmentRepository(database).list("s1"),
  ).resolves.toHaveLength(2);
});

it("links each upload to the message", async () => {
  const { database, execute } = databaseOf();
  await new ChatAttachmentRepository(database).link("s1", "m1", ["a1", "a2"]);
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { id: "a1", session_id: "s1", message_id: "m1" },
    { id: "a2", session_id: "s1", message_id: "m1" },
  ]);
});

it("removes an unsent attachment and returns its file", async () => {
  const removed = databaseOf([["st"]]);
  await expect(
    new ChatAttachmentRepository(removed.database).removeUnsent("u1", "a1"),
  ).resolves.toBe("st");
  const none = databaseOf([]);
  await expect(
    new ChatAttachmentRepository(none.database).removeUnsent("u1", "a1"),
  ).resolves.toBeNull();
});
