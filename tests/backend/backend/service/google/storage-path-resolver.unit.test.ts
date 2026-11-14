import { describe, expect, it, vi } from "vitest";

import { StoragePathResolver } from "@/backend/service/google/StoragePathResolver";

import type {
  DriveFolderMetadata,
  DriveRequestResult,
} from "@/backend/google/GoogleDriveFilesClient";

function folder(
  id: string,
  parentId: string | null,
  driveId: string | null = null,
): DriveFolderMetadata {
  return { id, name: id, parentId, driveId, isFolder: true, isTrashed: false };
}

describe("StoragePathResolver", () => {
  it("resolves My Drive by identifier and caches the root lookup", async () => {
    const readFolder = vi.fn<
      (
        token: string,
        id: string,
      ) => Promise<DriveRequestResult<DriveFolderMetadata>>
    >(async (token, id) => {
      expect(token).toBe("token");
      return {
        ok: true,
        value: folder(id === "root" ? "actual-root" : id, null),
      };
    });
    const resolver = new StoragePathResolver(
      { readFolder, readSharedDriveName: vi.fn() },
      "token",
    );
    const child = folder("child", "actual-root");
    const expected = [
      { id: "actual-root", name: "", role: "my_drive" },
      { id: "child", name: "child", role: "folder" },
    ];
    expect(await resolver.resolve(child)).toEqual(expected);
    expect(await resolver.resolve(child)).toEqual(expected);
    expect(
      readFolder.mock.calls.filter((call) => call[1] === "root"),
    ).toHaveLength(1);
  });

  it("marks inaccessible parents and unrelated roots as detached", async () => {
    const readFolder = vi.fn<
      (
        token: string,
        id: string,
      ) => Promise<DriveRequestResult<DriveFolderMetadata>>
    >(async () => ({
      ok: false,
      folderProblem: "not_found",
      connectionProblem: null,
    }));
    const resolver = new StoragePathResolver(
      { readFolder, readSharedDriveName: vi.fn() },
      "token",
    );
    expect(await resolver.resolve(folder("child", "hidden"))).toEqual([
      { id: "", name: "", role: "detached" },
      { id: "child", name: "child", role: "folder" },
    ]);
    expect(await resolver.resolve(folder("orphan", null))).toEqual([
      { id: "", name: "", role: "detached" },
      { id: "orphan", name: "orphan", role: "folder" },
    ]);
  });

  it("uses the shared drive name and falls back to folder metadata on refusal", async () => {
    const readSharedDriveName = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: "Team" })
      .mockResolvedValueOnce({
        ok: false,
        folderProblem: "not_found",
        connectionProblem: null,
      });
    const resolver = new StoragePathResolver(
      { readFolder: vi.fn(), readSharedDriveName },
      "token",
    );
    const root = folder("shared", null, "shared");
    expect(await resolver.resolve(root)).toEqual([
      { id: "shared-drives", name: "", role: "shared_drives" },
      { id: "shared", name: "Team", role: "shared_drive" },
    ]);
    expect((await resolver.resolve(root))[1]).toEqual({
      id: "shared",
      name: "shared",
      role: "shared_drive",
    });
  });
});
