import { vi } from "vitest";

import { GoogleDriveFileService } from "@/backend/service/google/GoogleDriveFileService";
import { StorageAccessService } from "@/backend/service/google/StorageAccessService";
import { StorageFileReader } from "@/backend/service/google/StorageFileReader";

import {
  createConnection,
  createFakeDrive,
  makeEntry,
} from "./storage-file-writer-harness";

import type { AccountAccess } from "@/definition/Authorization";
import type { StorageAccessRepository } from "@/backend/database/repositories/google/StorageAccessRepository";
import type { StorageGrant } from "@/definition/StorageAccess";

/** A current non-administrator agent and a mocked Drive/repository boundary. */
export function storageWorld(): {
  readonly account: AccountAccess;
  readonly grants: StorageGrant[];
  readonly repository: {
    readonly grants: ReturnType<
      typeof vi.fn<StorageAccessRepository["grants"]>
    >;
    readonly record: ReturnType<
      typeof vi.fn<StorageAccessRepository["record"]>
    >;
    readonly setGrant: ReturnType<
      typeof vi.fn<StorageAccessRepository["setGrant"]>
    >;
    readonly targets: ReturnType<
      typeof vi.fn<StorageAccessRepository["targets"]>
    >;
    readonly history: ReturnType<
      typeof vi.fn<StorageAccessRepository["history"]>
    >;
  };
  readonly readAccount: ReturnType<
    typeof vi.fn<(id: string) => Promise<AccountAccess | null>>
  >;
  readonly drive: ReturnType<typeof createFakeDrive>;
  readonly access: StorageAccessService;
  readonly files: GoogleDriveFileService;
} {
  const account: AccountAccess = {
    userId: "Ed",
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ed",
    lastName: "Agent",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    isAgent: true,
  };
  const grants: StorageGrant[] = [
    {
      permissionId: "permission",
      folderRef: "pages",
      folderName: "Pages",
      targetKind: "group",
      targetId: "a-team",
    },
  ];
  const repository = {
    grants: vi.fn<StorageAccessRepository["grants"]>(async () => grants),
    record: vi.fn<StorageAccessRepository["record"]>(async () => undefined),
    setGrant: vi.fn<StorageAccessRepository["setGrant"]>(async () => undefined),
    targets: vi.fn<StorageAccessRepository["targets"]>(async () => [
      { kind: "group", id: "a-team", name: "A-Team" },
    ]),
    history: vi.fn<StorageAccessRepository["history"]>(async () => []),
  };
  const readAccount = vi.fn<(id: string) => Promise<AccountAccess | null>>(
    async () => account,
  );
  const connection = createConnection();
  const drive = createFakeDrive([
    makeEntry("root", { isFolder: true, parentRef: null }),
    makeEntry("pages", { isFolder: true, name: "Pages" }),
    makeEntry("private", { isFolder: true, name: "Private" }),
    makeEntry("reports", { isFolder: true, parentRef: "pages" }),
    makeEntry("report", {
      parentRef: "reports",
      name: "report.md",
      mimeType: "text/markdown",
    }),
  ]);
  const access = new StorageAccessService({
    repository,
    account: readAccount,
    connection,
    reader: new StorageFileReader(connection, drive.client),
  });
  const files = new GoogleDriveFileService({
    connection,
    drive: drive.client,
    isSimulation: true,
    canRequestWriteAccess: false,
    access,
  });
  return { account, grants, repository, readAccount, drive, access, files };
}
