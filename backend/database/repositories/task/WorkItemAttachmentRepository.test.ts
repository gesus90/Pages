import { expect, it, vi } from "vitest";

import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import { WorkItemAttachmentRepository } from "./WorkItemAttachmentRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: WorkItemAttachmentRepository;
  readonly query: ReturnType<
    typeof vi.fn<(s: string, p?: object) => Promise<DatabaseValue[][]>>
  >;
  readonly execute: ReturnType<
    typeof vi.fn<(s: string, p?: object) => Promise<void>>
  >;
} {
  const query = vi.fn<(s: string, p?: object) => Promise<DatabaseValue[][]>>(
    async () => rows,
  );
  const execute = vi.fn<(s: string, p?: object) => Promise<void>>(
    async () => {},
  );
  return {
    repository: new WorkItemAttachmentRepository({ query, execute }),
    query,
    execute,
  };
}

const ROW: DatabaseValue[] = [
  "a1",
  "w1",
  "f.png",
  "image/png",
  "media",
  5,
  "sum",
  "s.png",
  "u1",
  "User",
  "2026",
  1,
];
const NEW_ATTACHMENT = {
  workItemId: "w1",
  fileName: "f.png",
  contentType: "image/png",
  kind: "media" as const,
  size: 5,
  checksum: "sum",
  storageName: "s.png",
  uploadedBy: "u1",
};

it("inserts an attachment under a given or generated id", async () => {
  const { repository, query } = repositoryOf([["2026"]]);

  await expect(repository.insert(NEW_ATTACHMENT, "a1")).resolves.toEqual({
    id: "a1",
    createdAt: "2026",
  });
  expect(query).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ requires_active_ticket: 0, id: "a1" }),
  );

  const generated = await repository.insert(NEW_ATTACHMENT, undefined, {
    requiresActiveTicket: true,
  });
  expect(generated.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(query).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ requires_active_ticket: 1 }),
  );
});

it("refuses to insert for a missing or archived ticket", async () => {
  await expect(
    repositoryOf().repository.insert(NEW_ATTACHMENT, "a1"),
  ).rejects.toBeInstanceOf(WorkItemNotFoundError);
});

it("maps attachments, falling back to file and no uploader", async () => {
  const other: DatabaseValue[] = [
    ...ROW.slice(0, 4),
    "other",
    ...ROW.slice(5, 9),
    null,
    "2026",
    0,
  ];
  const { repository } = repositoryOf([ROW, other]);

  const [media, file] = await repository.listAll();

  expect(media).toMatchObject({
    kind: "media",
    isSearchReleased: true,
    uploadedByName: "User",
    size: 5,
  });
  expect(file).toMatchObject({
    kind: "file",
    isSearchReleased: false,
    uploadedByName: null,
  });
  expect(await repository.listByWorkItem("w1")).toHaveLength(2);
});

it("updates only the storage facts", async () => {
  const { repository, execute } = repositoryOf();

  await repository.updateStorage({
    id: "a1",
    storageName: "n",
    contentType: "text/plain",
    kind: "file",
  });

  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    id: "a1",
    storage_name: "n",
    content_type: "text/plain",
    kind: "file",
  });
});

it("finds one attachment or null", async () => {
  await expect(
    repositoryOf([ROW]).repository.find("a1"),
  ).resolves.toMatchObject({ id: "a1" });
  await expect(repositoryOf().repository.find("x")).resolves.toBeNull();
});

it("deletes the metadata of an attachment", async () => {
  const { repository, execute } = repositoryOf();

  await repository.delete("a1");

  expect(execute).toHaveBeenCalledWith(expect.any(String), { id: "a1" });
});

it("releases or withdraws the search text of an attachment", async () => {
  const { repository, execute } = repositoryOf();

  await repository.setSearchRelease("a1", null);
  await repository.setSearchRelease("a1", "u1");

  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("DELETE"),
    {
      attachment_id: "a1",
    },
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("INSERT"),
    {
      attachment_id: "a1",
      released_by: "u1",
    },
  );
});

it("lists storage names of some tickets and of all", async () => {
  const { repository, query } = repositoryOf([["s1"], ["s2"]]);

  await expect(repository.findStorageNames(["w1"])).resolves.toEqual([
    "s1",
    "s2",
  ]);
  await expect(repository.listStorageNames()).resolves.toEqual(["s1", "s2"]);
  query.mockClear();
  await expect(repository.findStorageNames([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("maps asset changes", async () => {
  const { repository, query } = repositoryOf([
    [1, "a1", "w1", "deleted", "sum", "image/png", "t"],
    [2n, "a1", "w1", "stored", "sum", "image/png", "t"],
  ]);

  const changes = await repository.listChangesAfter(0, 10);

  expect(changes.map((change) => [change.position, change.change])).toEqual([
    [1, "deleted"],
    [2, "stored"],
  ]);
  expect(query).toHaveBeenCalledWith(expect.any(String), {
    after_position: 0,
    limit: 10,
  });
});
