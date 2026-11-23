import { expect, it, vi } from "vitest";

import { WikiAttachmentRepository } from "./WikiAttachmentRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);

  return { database: { execute, query }, execute, query };
}

function attachmentRow(
  kind: string,
  uploaderName: string | null,
): DatabaseValue[] {
  return [
    "id",
    "page",
    "a.png",
    "image/png",
    kind,
    7n,
    "sum",
    "stored",
    "user",
    uploaderName,
    "created",
  ];
}

it("inserts the metadata and returns the generated identifier", async () => {
  const { database, query } = databaseOf([["created"]]);

  const stored = await new WikiAttachmentRepository(database).insert({
    pageId: "page",
    fileName: "a.png",
    contentType: "image/png",
    kind: "media",
    size: 1,
    checksum: "sum",
    storageName: "stored",
    uploadedBy: "user",
  });

  expect(stored.createdAt).toBe("created");
  expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO wiki_attachments"),
    expect.objectContaining({ id: stored.id, page_id: "page" }),
  );
});

it("rejects an insert that returns no row", async () => {
  const { database } = databaseOf();

  await expect(
    new WikiAttachmentRepository(database).insert({
      pageId: "page",
      fileName: "a.png",
      contentType: "image/png",
      kind: "file",
      size: 1,
      checksum: "sum",
      storageName: "stored",
      uploadedBy: "user",
    }),
  ).rejects.toThrow('"created_at"');
});

it("lists attachments with media and file kinds", async () => {
  const { database } = databaseOf([
    attachmentRow("media", "Uploader"),
    attachmentRow("other", null),
  ]);

  const listed = await new WikiAttachmentRepository(database).listByPage("p");

  expect(listed.map((item) => item.kind)).toEqual(["media", "file"]);
  expect(listed.map((item) => item.uploadedByName)).toEqual(["Uploader", ""]);
  expect(listed[0]?.size).toBe(7);
});

it("finds one attachment or null", async () => {
  const found = databaseOf([attachmentRow("file", "U")]);
  const missing = databaseOf();

  await expect(
    new WikiAttachmentRepository(found.database).find("id"),
  ).resolves.toMatchObject({ id: "id", fileName: "a.png" });
  await expect(
    new WikiAttachmentRepository(missing.database).find("id"),
  ).resolves.toBeNull();
});

it("deletes the metadata of an attachment", async () => {
  const { database, execute } = databaseOf();

  await new WikiAttachmentRepository(database).delete("id");

  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM wiki_attachments"),
    { id: "id" },
  );
});

it("counts the attachments of a deletion group", async () => {
  const counted = databaseOf([[3]]);
  const empty = databaseOf();

  await expect(
    new WikiAttachmentRepository(counted.database).countByDeletionGroup("r"),
  ).resolves.toBe(3);
  await expect(
    new WikiAttachmentRepository(empty.database).countByDeletionGroup("r"),
  ).resolves.toBe(0);
});

it("lists the storage names", async () => {
  const { database } = databaseOf([["a"], ["b"]]);

  await expect(
    new WikiAttachmentRepository(database).listStorageNames(),
  ).resolves.toEqual(["a", "b"]);
});
