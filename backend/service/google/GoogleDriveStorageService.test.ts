import { describe, expect, it, vi } from "vitest";

import { GoogleDriveStorageService } from "./GoogleDriveStorageService";

import type {
  DriveFolderMetadata,
  DriveRequestFailure,
  DriveRequestResult,
} from "@/backend/google/GoogleDriveFilesClient";
import type { GoogleDriveAccess } from "@/backend/service/google/GoogleDriveConnectionService";
import type { GoogleDriveStorageDependencies } from "./GoogleDriveStorageService";

const TREE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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
    find: vi.fn(async () => null),
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

describe("GoogleDriveStorageService.browse", () => {
  it("reports an unusable connection", async () => {
    const { service } = setup({
      access: {
        ok: false,
        problem: "google_unreachable",
        state: "unavailable",
      },
    });

    expect(await service.browse(REQUEST)).toEqual({
      kind: "connection",
      problem: "google_unreachable",
      state: "unavailable",
    });
  });

  it("opens My Drive without a saved start folder", async () => {
    const { service } = setup({ isSimulation: true });

    const response = await service.browse(REQUEST);

    expect(response).toMatchObject({
      kind: "browse",
      isSimulation: true,
      reach: "full",
      hasSharedDrives: true,
      startFolder: null,
      accountEmail: "me@gmail.com",
      folder: {
        folderId: "rootid",
        name: "name-rootid",
        canBeStartFolder: true,
        nextPageToken: "next",
        path: [{ id: "rootid", name: "", role: "my_drive" }],
      },
    });
  });

  it("reports app-file reach for narrow scopes", async () => {
    const { service } = setup({
      access: okAccess({ grantedScopes: [FILE_SCOPE] }),
    });

    expect(await service.browse(REQUEST)).toMatchObject({
      reach: "app_files",
      hasSharedDrives: false,
      isSimulation: false,
    });
  });

  it("rejects a malformed folder id", async () => {
    const { service, files } = setup();

    const response = await service.browse({ ...REQUEST, folderId: "a/b" });

    expect(response).toMatchObject({
      folder: null,
      folderProblem: "not_found",
    });
    expect(files.readFolder).not.toHaveBeenCalled();
  });

  it("shows an explicit folder and passes the listing options", async () => {
    const { service, files } = setup();

    await service.browse({
      ...REQUEST,
      folderId: "f1",
      pageToken: "p",
      isFoldersOnly: true,
    });

    expect(files.listFolder).toHaveBeenCalledWith("token", {
      driveId: null,
      folderId: "f1",
      isFoldersOnly: true,
      pageToken: "p",
    });
  });

  it("names a folder detached when its parent is refused", async () => {
    const { service } = setup({
      folders: [folderOf("f1", { parentId: "gone" })],
    });

    const response = await service.browse({ ...REQUEST, folderId: "f1" });

    expect(response).toMatchObject({
      folder: {
        name: "name-f1",
        path: [
          { id: "", name: "", role: "detached" },
          { id: "f1", name: "name-f1", role: "folder" },
        ],
      },
    });
  });

  it("names a detached top folder when the My Drive root is unknown", async () => {
    const { service } = setup({
      folders: [folderOf("f1", { parentId: null })],
    });

    const response = await service.browse({ ...REQUEST, folderId: "f1" });

    expect(response).toMatchObject({
      folder: { path: [{ role: "detached" }, { id: "f1", role: "folder" }] },
    });
  });
});

describe("GoogleDriveStorageService.browse shared drives and failures", () => {
  it("shows a shared drive root with the name Drive reports", async () => {
    const { service, files } = setup({
      folders: [folderOf("d1", { parentId: null, driveId: "d1" })],
    });

    const response = await service.browse({ ...REQUEST, folderId: "d1" });

    expect(response).toMatchObject({
      folder: {
        name: "Team drive",
        path: [
          { id: "shared-drives", role: "shared_drives" },
          { id: "d1", name: "Team drive", role: "shared_drive" },
        ],
      },
    });
    expect(files.listFolder).toHaveBeenCalledWith(
      "token",
      expect.objectContaining({ driveId: "d1" }),
    );
  });

  it("falls back to the folder name when the shared drive name fails", async () => {
    const { service, files } = setup({
      folders: [folderOf("d1", { parentId: null, driveId: "d1" })],
    });
    vi.mocked(files.readSharedDriveName).mockResolvedValue(
      failureOf("not_found"),
    );

    const response = await service.browse({ ...REQUEST, folderId: "d1" });

    expect(response).toMatchObject({ folder: { name: "name-d1" } });
  });

  it("lists shared drives for full reach", async () => {
    const { service, files } = setup();

    const response = await service.browse({
      ...REQUEST,
      folderId: "shared-drives",
      pageToken: "p",
    });

    expect(files.listSharedDrives).toHaveBeenCalledWith("token", "p");
    expect(response).toMatchObject({
      folder: { folderId: "shared-drives", canBeStartFolder: false, name: "" },
    });
  });

  it("refuses shared drives for narrow reach", async () => {
    const { service } = setup({
      access: okAccess({ grantedScopes: [FILE_SCOPE] }),
    });

    expect(
      await service.browse({ ...REQUEST, folderId: "shared-drives" }),
    ).toMatchObject({ folder: null, folderProblem: "scope_insufficient" });
  });

  it("reports a failing shared drive listing", async () => {
    const { service, files } = setup();
    vi.mocked(files.listSharedDrives).mockResolvedValue(failureOf("not_found"));

    expect(
      await service.browse({ ...REQUEST, folderId: "shared-drives" }),
    ).toMatchObject({ folderProblem: "not_found" });
  });

  it("reports trashed and non-folder targets", async () => {
    const { service } = setup({
      folders: [
        folderOf("t1", { isTrashed: true }),
        folderOf("n1", { isFolder: false }),
      ],
    });

    expect(await service.browse({ ...REQUEST, folderId: "t1" })).toMatchObject({
      folderProblem: "trashed",
    });
    expect(await service.browse({ ...REQUEST, folderId: "n1" })).toMatchObject({
      folderProblem: "not_folder",
    });
  });

  it("reports a failing folder listing", async () => {
    const { service, files } = setup();
    vi.mocked(files.listFolder).mockResolvedValue(failureOf("not_found"));

    expect(await service.browse({ ...REQUEST, folderId: "f1" })).toMatchObject({
      folder: null,
      folderProblem: "not_found",
    });
  });

  it.each([
    ["access_revoked", "reauthorization_required"],
    ["scope_missing", "reauthorization_required"],
    ["account_changed", "reauthorization_required"],
    ["secret_unavailable", "reauthorization_required"],
    ["google_unreachable", "unavailable"],
  ] as const)("maps the connection problem %s", async (problem, state) => {
    const { service, files } = setup();
    vi.mocked(files.listFolder).mockResolvedValue(
      failureOf("not_found", problem),
    );

    expect(await service.browse({ ...REQUEST, folderId: "f1" })).toEqual({
      kind: "connection",
      problem,
      state,
    });
  });
});

describe("GoogleDriveStorageService.readQuota", () => {
  it("reports an unusable connection", async () => {
    const { service } = setup({
      access: {
        ok: false,
        problem: "google_unreachable",
        state: "unavailable",
      },
    });

    expect(await service.readQuota()).toMatchObject({ kind: "connection" });
  });

  it("maps a refused connection of the quota request", async () => {
    const { service, files } = setup();
    vi.mocked(files.readQuota).mockResolvedValue(
      failureOf("not_found", "scope_missing"),
    );

    expect(await service.readQuota()).toEqual({
      kind: "connection",
      problem: "scope_missing",
      state: "reauthorization_required",
    });
  });

  it("reports an unavailable quota", async () => {
    const { service, files } = setup();
    vi.mocked(files.readQuota).mockResolvedValue(failureOf("not_found"));

    expect(await service.readQuota()).toEqual({ kind: "quota_unavailable" });
  });

  it("reads a consumer quota as not pooled", async () => {
    const { service } = setup();

    expect(await service.readQuota()).toEqual({
      kind: "quota",
      quota: {
        isPossiblyPooled: false,
        limitBytes: 10,
        usageBytes: 5,
        usageInDriveBytes: 3,
      },
    });
  });

  it.each([
    [{ emailAddress: "Me@Corp.example" }, "x@gmail.com", true],
    [{ emailAddress: null }, "x@GoogleMail.com", false],
    [{ emailAddress: null }, null, true],
  ] as const)(
    "judges pooling for %j and %s",
    async (reading, email, pooled) => {
      const { service, files } = setup({
        access: okAccess({ accountEmail: email }),
      });
      vi.mocked(files.readQuota).mockResolvedValue({
        ok: true,
        value: {
          usageBytes: 1,
          usageInDriveBytes: null,
          limitBytes: null,
          ...reading,
        },
      });

      expect(await service.readQuota()).toMatchObject({
        quota: { isPossiblyPooled: pooled },
      });
    },
  );
});

describe("GoogleDriveStorageService start folder", () => {
  it("rejects invalid identifiers", async () => {
    const { service, access } = setup();

    expect(await service.saveStartFolder("u1", "a b")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await service.saveStartFolder("u1", "shared-drives")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(access).not.toHaveBeenCalled();
  });

  it("fails without a usable connection", async () => {
    const { service } = setup({
      access: {
        ok: false,
        problem: "google_unreachable",
        state: "unavailable",
      },
    });

    expect(await service.saveStartFolder("u1", "f1")).toEqual({
      ok: false,
      error: "connection",
    });
  });

  it("reports a connection problem of Drive", async () => {
    const { service, files } = setup();
    vi.mocked(files.readFolder).mockResolvedValue(
      failureOf("not_found", "access_revoked"),
    );

    expect(await service.saveStartFolder("u1", "f1")).toEqual({
      ok: false,
      error: "connection",
    });
  });

  it("reports a folder problem", async () => {
    const { service, startFolders } = setup({
      folders: [folderOf("t1", { isTrashed: true })],
    });

    expect(await service.saveStartFolder("u1", "t1")).toEqual({
      ok: false,
      error: "trashed",
    });
    expect(startFolders.save).not.toHaveBeenCalled();
  });

  it("saves the folder Drive confirmed", async () => {
    const { service, startFolders } = setup();

    const result = await service.saveStartFolder("u1", "f1");

    expect(result).toMatchObject({
      ok: true,
      startFolder: { folderId: "f1", name: "name-f1" },
    });
    expect(startFolders.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        folderId: "f1",
        driveId: null,
        googlePermissionId: "perm-1",
        folderName: "name-f1",
      }),
      1234,
    );
  });

  it("uses the system clock by default", async () => {
    const { service, startFolders } = setup({ withClock: false });

    await service.saveStartFolder("u1", "f1");

    expect(startFolders.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
    );
  });

  it("clears the start folder", async () => {
    const { service, startFolders } = setup();

    expect(await service.clearStartFolder("u1")).toEqual({
      ok: true,
      startFolder: null,
    });
    expect(startFolders.remove).toHaveBeenCalledWith("u1");
  });
});
