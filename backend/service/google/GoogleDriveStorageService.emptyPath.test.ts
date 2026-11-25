import { describe, expect, it, vi } from "vitest";

import { GoogleDriveStorageService } from "./GoogleDriveStorageService";

vi.mock("@/backend/service/google/StoragePathResolver", () => ({
  StoragePathResolver: class {
    /** Resolves nothing. */
    public async resolve(): Promise<never[]> {
      return [];
    }
  },
}));

describe("GoogleDriveStorageService with an empty resolved path", () => {
  it("falls back to the folder name", async () => {
    const save = vi.fn(async () => undefined);
    const service = new GoogleDriveStorageService({
      connection: {
        access: async () => ({
          ok: true,
          accessToken: "t",
          accountEmail: null,
          grantedScopes: [],
          permissionId: "p",
        }),
      },
      files: {
        readFolder: vi.fn(async () => ({
          ok: true as const,
          value: {
            id: "f1",
            name: "Folder",
            isFolder: true,
            isTrashed: false,
            parentId: null,
            driveId: null,
          },
        })),
        readSharedDriveName: vi.fn(),
        listFolder: vi.fn(),
        listSharedDrives: vi.fn(),
        readQuota: vi.fn(),
      },
      startFolders: {
        find: vi.fn(),
        save,
        rename: vi.fn(),
        remove: vi.fn(),
      },
    });

    expect(await service.saveStartFolder("u1", "f1")).toMatchObject({
      ok: true,
      startFolder: { name: "Folder", path: [] },
    });
  });
});
