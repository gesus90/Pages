import { expect, it, vi } from "vitest";

import { StorageStartFolderRepository } from "./StorageStartFolderRepository";

import type { StoredStorageStartFolder } from "./StorageStartFolderRepository";

import type { Database } from "@/backend/database/Database";

const FOLDER: StoredStorageStartFolder = {
  userId: "u1",
  googlePermissionId: "g1",
  folderId: "f1",
  driveId: null,
  folderName: "Docs",
  folderPath: "/Docs",
};

it("maps the stored start folder", async () => {
  const query = vi.fn<Database["query"]>(async () => [
    ["u1", "g1", "f1", "d1", "Docs", "/Docs"],
  ]);
  const repository = new StorageStartFolderRepository({
    query,
    execute: vi.fn(),
  });

  await expect(repository.find("u1")).resolves.toEqual({
    ...FOLDER,
    driveId: "d1",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
});

it("returns null when no start folder was saved", async () => {
  const repository = new StorageStartFolderRepository({
    query: vi.fn(async () => []),
    execute: vi.fn(),
  });

  await expect(repository.find("u1")).resolves.toBeNull();
});

it("saves, renames and removes the start folder", async () => {
  const execute = vi.fn();
  const repository = new StorageStartFolderRepository({
    query: vi.fn(),
    execute,
  });

  await repository.save(FOLDER, 5);
  await repository.rename({
    userId: "u1",
    folderId: "f1",
    folderName: "New",
    folderPath: "/New",
  });
  await repository.remove("u1");

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    saved_at: 5,
    drive_id: null,
    user_id: "u1",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    folder_id: "f1",
    folder_name: "New",
    folder_path: "/New",
    user_id: "u1",
  });
  expect(execute.mock.calls[2]?.[1]).toEqual({ user_id: "u1" });
});
