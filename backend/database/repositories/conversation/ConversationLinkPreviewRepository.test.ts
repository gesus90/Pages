import { expect, it, vi } from "vitest";

import { ConversationLinkPreviewRepository } from "./ConversationLinkPreviewRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationLinkPreviewRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return {
    repository: new ConversationLinkPreviewRepository({ execute, query }),
    execute,
    query,
  };
}

const withImage: DatabaseValue[] = [
  "http://a.test",
  "Title",
  "Text",
  "img-1",
  "image/png",
  "2026-01-01T00:00:00Z",
];
const withoutImage: DatabaseValue[] = [
  "http://b.test",
  "Other",
  "",
  null,
  null,
  "2026-01-02T00:00:00Z",
];

it("finds stored previews by URL with and without an image", async () => {
  const { repository } = databaseOf([withImage, withoutImage]);
  const found = await repository.find(["http://a.test", "http://b.test"]);
  expect(found.get("http://a.test")?.image).toEqual({
    storageName: "img-1",
    mimeType: "image/png",
  });
  expect(found.get("http://b.test")?.image).toBeNull();
});

it("does not query without URLs", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.find([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});

it("saves a preview and returns the image of the replaced row", async () => {
  const { repository, execute } = databaseOf([withImage]);
  await expect(
    repository.save({
      url: "http://a.test",
      title: "New",
      description: "d",
      image: { storageName: "img-2", mimeType: "image/jpeg" },
      fetchedAt: "2026-02-01T00:00:00Z",
    }),
  ).resolves.toBe("img-1");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    image_storage_name: "img-2",
    image_mime_type: "image/jpeg",
  });
});

it("saves a new preview without an image", async () => {
  const { repository, execute } = databaseOf();
  await expect(
    repository.save({
      url: "http://a.test",
      title: "New",
      description: "d",
      image: null,
      fetchedAt: "2026-02-01T00:00:00Z",
    }),
  ).resolves.toBeNull();
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    image_storage_name: null,
    image_mime_type: null,
  });
});

it("returns null when the replaced row had no image", async () => {
  const { repository } = databaseOf([withoutImage]);
  await expect(
    repository.save({
      url: "http://b.test",
      title: "t",
      description: "d",
      image: null,
      fetchedAt: "2026-02-01T00:00:00Z",
    }),
  ).resolves.toBeNull();
});

it("removes old previews and returns only their image names", async () => {
  const { repository, query } = databaseOf([["img-1"], [null]]);
  await expect(
    repository.removeBefore("2026-01-31T00:00:00Z"),
  ).resolves.toEqual(["img-1"]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    fetched_before: "2026-01-31T00:00:00Z",
  });
});

it("lists the image names that previews still hold", async () => {
  const { repository } = databaseOf([["img-1"], ["img-2"]]);
  await expect(repository.storageNames()).resolves.toEqual(
    new Set(["img-1", "img-2"]),
  );
});
