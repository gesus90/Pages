import { describe, expect, it, vi } from "vitest";

import { GoogleDriveStorageService } from "./GoogleDriveStorageService";

import type {
  DriveFolderMetadata,
  DriveRequestFailure,
  DriveRequestResult,
} from "@/backend/google/GoogleDriveFilesClient";
import type { StoredStorageStartFolder } from "@/backend/database/repositories/google/StorageStartFolderRepository";
import type { GoogleDriveAccess } from "@/backend/service/google/GoogleDriveConnectionService";
import type { GoogleDriveStorageDependencies } from "./GoogleDriveStorageService";

const TREE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function folderOf(
  id: string,
  overrides: Partial<DriveFolderMetadata> = {},
): DriveFolderMetadata {
  return {
    id,
    name: `name-${id}`,
    isFolder: true,
    isTrashed: false,
    parentId: "rootid",
    driveId: null,
    ...overrides,
  };
}

function failureOf(
  folderProblem: DriveRequestFailure["folderProblem"],
  connectionProblem: DriveRequestFailure["connectionProblem"] = null,
): DriveRequestFailure {
  return { ok: false, folderProblem, connectionProblem };
}

function okAccess(
  overrides: Partial<Extract<GoogleDriveAccess, { ok: true }>> = {},
): GoogleDriveAccess {
  return {
    ok: true,
    accessToken: "token",
    accountEmail: "me@gmail.com",
    grantedScopes: [TREE_SCOPE],
    permissionId: "perm-1",
    ...overrides,
  };
}

function storedOf(
  overrides: Partial<StoredStorageStartFolder> = {},
): StoredStorageStartFolder {
  return {
    userId: "u1",
    googlePermissionId: "perm-1",
    folderId: "f1",
    driveId: null,
    folderName: "name-f1",
    folderPath: JSON.stringify([
      { id: "rootid", name: "", role: "my_drive" },
      { id: "f1", name: "name-f1", role: "folder" },
    ]),
    ...overrides,
  };
}

interface Setup {
  readonly service: GoogleDriveStorageService;
  readonly files: GoogleDriveStorageDependencies["files"];
  readonly startFolders: GoogleDriveStorageDependencies["startFolders"];
  readonly access: ReturnType<typeof vi.fn>;
}

function setup(
  options: {
    readonly access?: GoogleDriveAccess;
    readonly folders?: readonly DriveFolderMetadata[];
    readonly saved?: StoredStorageStartFolder | null;
    readonly isSimulation?: boolean;
    readonly withClock?: boolean;
  } = {},
): Setup {
  const folders = new Map<string, DriveFolderMetadata>(
    (
      options.folders ?? [
        folderOf("rootid", { parentId: null }),
        folderOf("f1"),
      ]
    ).map((folder) => [folder.id, folder]),
  );
  const rootFolder = folders.get("rootid");
  if (rootFolder) folders.set("root", rootFolder);
  const files: GoogleDriveStorageDependencies["files"] = {
    readFolder: vi.fn(
      async (
        accessToken: string,
        id: string,
      ): Promise<DriveRequestResult<DriveFolderMetadata>> => {
        const folder = folders.get(id);
        return folder ? { ok: true, value: folder } : failureOf("not_found");
      },
    ),
    readSharedDriveName: vi.fn(async () => ({
      ok: true as const,
      value: "Team drive",
    })),
    listFolder: vi.fn(async () => ({
      ok: true as const,
      value: { items: [], nextPageToken: "next" },
    })),
    listSharedDrives: vi.fn(async () => ({
      ok: true as const,
      value: { items: [], nextPageToken: null },
    })),
    readQuota: vi.fn(async () => ({
      ok: true as const,
      value: {
        usageBytes: 5,
        usageInDriveBytes: 3,
        limitBytes: 10,
        emailAddress: "me@gmail.com",
      },
    })),
  };
  const startFolders: GoogleDriveStorageDependencies["startFolders"] = {
    find: vi.fn(async () => options.saved ?? null),
    save: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const access = vi.fn(async () => options.access ?? okAccess());
  const service = new GoogleDriveStorageService({
    connection: { access },
    files,
    startFolders,
    isSimulation: options.isSimulation,
    ...(options.withClock === false ? {} : { now: () => 1234 }),
  });
  return { service, files, startFolders, access };
}

const REQUEST = {
  userId: "u1",
  folderId: null,
  pageToken: null,
  isFoldersOnly: false,
} as const;

describe("GoogleDriveStorageService.browse with a start folder", () => {
  it("opens the saved folder unchanged without renaming", async () => {
    const { service, startFolders } = setup({ saved: storedOf() });

    const response = await service.browse(REQUEST);

    expect(response).toMatchObject({
      folder: { folderId: "f1" },
      startFolder: { folderId: "f1", name: "name-f1" },
      startFolderRenamedFrom: null,
    });
    expect(startFolders.rename).not.toHaveBeenCalled();
  });

  it("stores and reports a renamed folder", async () => {
    const { service, startFolders } = setup({
      saved: storedOf({ folderName: "old" }),
    });

    const response = await service.browse(REQUEST);

    expect(response).toMatchObject({
      startFolder: { folderId: "f1", name: "name-f1" },
      startFolderRenamedFrom: "old",
    });
    expect(startFolders.rename).toHaveBeenCalledWith({
      folderId: "f1",
      folderName: "name-f1",
      folderPath: JSON.stringify([
        { id: "rootid", name: "", role: "my_drive" },
        { id: "f1", name: "name-f1", role: "folder" },
      ]),
      userId: "u1",
    });
  });

  it("stores a changed path without reporting a rename", async () => {
    const { service, startFolders } = setup({
      saved: storedOf({ folderPath: "[]" }),
    });

    const response = await service.browse(REQUEST);

    expect(response).toMatchObject({ startFolderRenamedFrom: null });
    expect(startFolders.rename).toHaveBeenCalledTimes(1);
  });

  it("reports a start folder of another Google account", async () => {
    const { service, files } = setup({
      saved: storedOf({ googlePermissionId: "other" }),
    });

    expect(await service.browse(REQUEST)).toMatchObject({
      folder: null,
      startFolder: null,
      startFolderProblem: "other_account",
    });
    expect(files.readFolder).not.toHaveBeenCalled();
  });

  it("shows an explicit target without the foreign start folder", async () => {
    const { service } = setup({
      saved: storedOf({ googlePermissionId: "other" }),
    });

    expect(await service.browse({ ...REQUEST, folderId: "f1" })).toMatchObject({
      startFolder: null,
      folder: { folderId: "f1" },
    });
  });
});

describe("GoogleDriveStorageService.browse start folder problems", () => {
  it("reports a start folder Drive no longer shows", async () => {
    const { service } = setup({ saved: storedOf({ folderId: "missing" }) });

    expect(await service.browse(REQUEST)).toMatchObject({
      folder: null,
      startFolderProblem: "not_found",
    });
  });

  it("maps a connection problem of the start folder", async () => {
    const { service, files } = setup({ saved: storedOf() });
    vi.mocked(files.listFolder).mockResolvedValue(
      failureOf("not_found", "access_revoked"),
    );

    expect(await service.browse(REQUEST)).toMatchObject({
      kind: "connection",
      state: "reauthorization_required",
    });
  });

  it("reads a damaged stored path as empty", async () => {
    const { service } = setup({ saved: storedOf({ folderPath: "{oops" }) });

    expect(await service.browse(REQUEST)).toMatchObject({
      startFolder: { name: "name-f1" },
    });
  });

  it("keeps only valid entries of the stored path", async () => {
    const path = [
      { id: "a", name: "A", role: "folder" },
      null,
      "text",
      { name: "x", role: "folder" },
      { id: "a" },
      { id: "a", name: "A" },
      { id: 1, name: "A", role: "folder" },
    ];
    const { service } = setup({
      saved: storedOf({ folderPath: JSON.stringify(path) }),
      access: okAccess(),
    });
    const response = await service.browse({ ...REQUEST, folderId: "f1" });

    expect(response).toMatchObject({
      startFolder: { path: [{ id: "a", name: "A", role: "folder" }] },
    });
  });

  it("reads a non-array stored path as empty", async () => {
    const { service } = setup({
      saved: storedOf({ folderPath: '{"id":"a"}' }),
    });

    expect(await service.browse({ ...REQUEST, folderId: "f1" })).toMatchObject({
      startFolder: { path: [] },
    });
  });
});
