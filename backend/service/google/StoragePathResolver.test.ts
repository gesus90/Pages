import { describe, expect, it, vi } from "vitest";

import { StoragePathResolver } from "./StoragePathResolver";

import type {
  DriveFolderMetadata,
  DriveRequestResult,
} from "@/backend/google/GoogleDriveFilesClient";
import type { StoragePathReader } from "./StoragePathResolver";

function folderOf(
  id: string,
  parentId: string | null,
  overrides: Partial<DriveFolderMetadata> = {},
): DriveFolderMetadata {
  return {
    id,
    name: `Name ${id}`,
    isFolder: true,
    isTrashed: false,
    parentId,
    driveId: null,
    ...overrides,
  };
}

const FAILURE: DriveRequestResult<never> = {
  ok: false,
  folderProblem: "not_found",
  connectionProblem: null,
};

function readerOf(
  folders: readonly DriveFolderMetadata[],
  driveName: DriveRequestResult<string> = { ok: true, value: "Team" },
): StoragePathReader {
  return {
    readFolder: vi.fn(async (...request: [string, string]) => {
      const id = request[1];
      const found = folders.find((folder) => folder.id === id);

      return found ? { ok: true as const, value: found } : FAILURE;
    }),
    readSharedDriveName: vi.fn(async () => driveName),
  };
}

describe("StoragePathResolver", () => {
  it("builds the path below My Drive", async () => {
    const root = folderOf("root", null);
    const a = folderOf("a", "root");
    const b = folderOf("b", "a");
    const reader = readerOf([root, a, b]);
    const path = await new StoragePathResolver(reader, "token").resolve(b);

    expect(path).toEqual([
      { id: "root", name: "", role: "my_drive" },
      { id: "a", name: "Name a", role: "folder" },
      { id: "b", name: "Name b", role: "folder" },
    ]);
  });

  it("asks for the My Drive root only once", async () => {
    const root = folderOf("root", null);
    const reader = readerOf([root]);
    const resolver = new StoragePathResolver(reader, "token");

    await resolver.resolve(root);
    await resolver.resolve(root);

    expect(reader.readFolder).toHaveBeenCalledTimes(1);
  });

  it("detaches a top folder that is not the My Drive root", async () => {
    const top = folderOf("top", null);
    const reader = readerOf([folderOf("root", null)]);
    const path = await new StoragePathResolver(reader, "token").resolve(top);

    expect(path).toEqual([
      { id: "", name: "", role: "detached" },
      { id: "top", name: "Name top", role: "folder" },
    ]);
  });

  it("detaches when the My Drive root cannot be read", async () => {
    const top = folderOf("top", null);
    const path = await new StoragePathResolver(readerOf([]), "t").resolve(top);

    expect(path.map((entry) => entry.role)).toEqual(["detached", "folder"]);
  });

  it("names a shared drive root", async () => {
    const drive = folderOf("drive-1", null, { driveId: "drive-1" });
    const child = folderOf("child", "drive-1", { driveId: "drive-1" });
    const path = await new StoragePathResolver(
      readerOf([drive, child]),
      "token",
    ).resolve(child);

    expect(path).toEqual([
      { id: "shared-drives", name: "", role: "shared_drives" },
      { id: "drive-1", name: "Team", role: "shared_drive" },
      { id: "child", name: "Name child", role: "folder" },
    ]);
  });

  it("falls back to the folder name when the drive name is unknown", async () => {
    const drive = folderOf("drive-1", null, { driveId: "drive-1" });
    const path = await new StoragePathResolver(
      readerOf([drive], FAILURE),
      "token",
    ).resolve(drive);

    expect(path[1]).toEqual({
      id: "drive-1",
      name: "Name drive-1",
      role: "shared_drive",
    });
  });

  it("detaches a shared folder that is not the drive root", async () => {
    const folder = folderOf("f", null, { driveId: "drive-1" });
    const path = await new StoragePathResolver(readerOf([]), "t").resolve(
      folder,
    );

    expect(path.map((entry) => entry.role)).toEqual(["detached", "folder"]);
  });

  it("starts with a detached step when a parent is refused", async () => {
    const child = folderOf("child", "hidden");
    const path = await new StoragePathResolver(readerOf([]), "t").resolve(
      child,
    );

    expect(path).toEqual([
      { id: "", name: "", role: "detached" },
      { id: "child", name: "Name child", role: "folder" },
    ]);
  });

  it("cuts off a tree deeper than the limit", async () => {
    const folders: DriveFolderMetadata[] = [];

    for (let index = 0; index < 40; index += 1) {
      folders.push(folderOf(`f${index}`, `f${index + 1}`));
    }

    const reader = readerOf(folders);
    const path = await new StoragePathResolver(reader, "t").resolve(
      folders[0] ?? folderOf("none", null),
    );

    expect(path).toHaveLength(31);
    expect(path[0]?.role).toBe("detached");
  });
});
