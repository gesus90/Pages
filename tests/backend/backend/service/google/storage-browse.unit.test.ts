import { expect, it, vi } from "vitest";

import { GoogleDriveStorageService } from "@/backend/service/google/GoogleDriveStorageService";
import { STORAGE_SHARED_DRIVES_ID } from "@/definition/GoogleDriveStorage";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { GoogleDriveStorageDependencies } from "@/backend/service/google/GoogleDriveStorageService";

const access = {
  ok: true as const,
  accessToken: "token",
  permissionId: "permission",
  accountEmail: "person@gmail.com",
  grantedScopes: [],
};
const request = {
  userId: "user",
  folderId: null,
  pageToken: null,
  isFoldersOnly: false,
};

it("opens My Drive, persists the selected root and clears it", async () => {
  const root = {
    id: "root",
    name: "My Drive",
    isFolder: true,
    isTrashed: false,
    parentId: null,
    driveId: null,
  };
  const files = {
    readFolder: vi.fn(async () => ({ ok: true as const, value: root })),
    listFolder: vi.fn(async () => ({
      ok: true as const,
      value: { items: [], nextPageToken: null },
    })),
  };
  const startFolders = {
    find: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const service = new GoogleDriveStorageService(
    partial<GoogleDriveStorageDependencies>({
      connection: { access: async () => access },
      files,
      startFolders,
      now: () => 100,
    }),
  );
  await expect(service.browse(request)).resolves.toMatchObject({
    kind: "browse",
    reach: "app_files",
    folder: { folderId: "root", items: [] },
  });
  await expect(service.saveStartFolder("user", "root")).resolves.toMatchObject({
    ok: true,
    startFolder: { folderId: "root" },
  });
  expect(startFolders.save).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user",
      googlePermissionId: "permission",
      folderId: "root",
    }),
    100,
  );
  await expect(service.clearStartFolder("user")).resolves.toEqual({
    ok: true,
    startFolder: null,
  });
  expect(startFolders.remove).toHaveBeenCalledWith("user");
});

it("refuses invalid targets, restricted shared drives and inaccessible folders", async () => {
  const files = {
    readFolder: vi.fn(async () => ({
      ok: false as const,
      connectionProblem: null,
      folderProblem: "not_found" as const,
    })),
  };
  const service = new GoogleDriveStorageService(
    partial<GoogleDriveStorageDependencies>({
      connection: { access: async () => access },
      files,
      startFolders: { find: async () => null },
    }),
  );
  await expect(
    service.browse({ ...request, folderId: "bad id" }),
  ).resolves.toMatchObject({ folderProblem: "not_found" });
  await expect(
    service.browse({ ...request, folderId: STORAGE_SHARED_DRIVES_ID }),
  ).resolves.toMatchObject({ folderProblem: "scope_insufficient" });
  await expect(service.saveStartFolder("user", "missing")).resolves.toEqual({
    ok: false,
    error: "not_found",
  });
  await expect(service.saveStartFolder("user", "bad id")).resolves.toEqual({
    ok: false,
    error: "invalid",
  });
});

it("reports quota and translates a revoked connection", async () => {
  const files = {
    readQuota: vi.fn(async () => ({
      ok: true as const,
      value: {
        emailAddress: null,
        usageBytes: 20,
        usageInDriveBytes: 10,
        limitBytes: 100,
      },
    })),
  };
  const service = new GoogleDriveStorageService(
    partial<GoogleDriveStorageDependencies>({
      connection: { access: async () => access },
      files,
    }),
  );
  await expect(service.readQuota()).resolves.toEqual({
    kind: "quota",
    quota: {
      isPossiblyPooled: false,
      usageBytes: 20,
      usageInDriveBytes: 10,
      limitBytes: 100,
    },
  });
  const revoked = new GoogleDriveStorageService(
    partial<GoogleDriveStorageDependencies>({
      connection: {
        access: async () => ({
          ok: false,
          state: "reauthorization_required",
          problem: "access_revoked",
        }),
      },
    }),
  );
  await expect(revoked.browse(request)).resolves.toMatchObject({
    kind: "connection",
    problem: "access_revoked",
  });
  await expect(revoked.saveStartFolder("user", "root")).resolves.toEqual({
    ok: false,
    error: "connection",
  });
});
