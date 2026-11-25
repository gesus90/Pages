import { describe, expect, it, vi } from "vitest";

import { GOOGLE_DRIVE_WRITE_SCOPES } from "@/backend/google/GoogleDriveConfig";

import { StorageConfirmations } from "./StorageConfirmations";
import { StorageFileWriter } from "./StorageFileWriter";

import type {
  DriveEntryChange,
  DriveItemResult,
} from "@/backend/google/GoogleDriveItemsClient";
import type { Mock } from "vitest";
import type {
  StorageConnection,
  StorageDriveClient,
} from "./StorageFileSupport";
import type {
  StorageEntry,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

const USER = "user-1";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function entryOf(
  ref: string,
  overrides: Partial<StorageEntry> = {},
): StorageEntry {
  return {
    driveRef: null,
    exportFormats: [],
    isExplicitlyTrashed: false,
    isFolder: false,
    isGoogleDocument: false,
    isTrashed: false,
    mimeType: "text/plain",
    modifiedAt: null,
    name: ref,
    parentRef: "dir",
    ref,
    sizeBytes: null,
    version: "1",
    webViewLink: null,
    ...overrides,
  };
}

function folderOf(
  ref: string,
  parentRef: string | null = "top",
  overrides: Partial<StorageEntry> = {},
): StorageEntry {
  return entryOf(ref, {
    isFolder: true,
    mimeType: FOLDER_MIME,
    parentRef,
    ...overrides,
  });
}

const FAILURE = {
  code: "provider_unreachable",
  connectionProblem: null,
  ok: false,
} as const;

const DEFAULT_ENTRIES: readonly StorageEntry[] = [
  folderOf("dir"),
  folderOf("dst"),
  entryOf("file1", { name: "a.txt" }),
];

type QueryResult = Promise<
  DriveItemResult<{
    readonly entries: readonly StorageEntry[];
    readonly nextPageToken: string | null;
  }>
>;

/** Drive listing over the entries; the n-th call can be made to fail. */
function listingOf(store: ReadonlyMap<string, StorageEntry>): {
  readonly query: (
    token: string,
    request: { readonly query: string },
  ) => QueryResult;
  readonly failCall: (call: number) => void;
} {
  let calls = 0;
  let failingCall = 0;

  return {
    failCall: (call) => {
      failingCall = call;
    },
    query: async (token, request) => {
      calls += 1;

      if (calls === failingCall) return FAILURE;

      const parent = /^'([^']+)' in parents/.exec(request.query)?.[1];
      const exact = /name = '([^']*)'/.exec(request.query)?.[1];
      const part = /name contains '([^']*)'/.exec(request.query)?.[1];
      const isLive = request.query.includes("trashed = false");
      const matching = [...store.values()].filter(
        (entry) =>
          entry.parentRef === parent &&
          (exact === undefined || entry.name === exact) &&
          (part === undefined || entry.name.includes(part)) &&
          (!isLive || !entry.isTrashed),
      );

      return { ok: true, value: { entries: matching, nextPageToken: null } };
    },
  };
}

function changeOf(
  store: ReadonlyMap<string, StorageEntry>,
  ref: string,
  change: DriveEntryChange,
): DriveItemResult<StorageEntry> {
  const found = store.get(ref);

  if (!found) return FAILURE;

  return {
    ok: true,
    value: {
      ...found,
      isTrashed: change.isTrashed ?? found.isTrashed,
      name: change.name ?? found.name,
      parentRef: change.addParentId ?? found.parentRef,
    },
  };
}

type FakeDrive = {
  readonly [Key in keyof StorageDriveClient]: Mock<StorageDriveClient[Key]>;
} & { readonly failQueryCall: (call: number) => void };

interface FakeConnection {
  readonly access: Mock<StorageConnection["access"]>;
}

function fakeDrive(
  entries: readonly StorageEntry[] = DEFAULT_ENTRIES,
): FakeDrive {
  const store = new Map(entries.map((entry) => [entry.ref, entry]));
  const listing = listingOf(store);

  return {
    change: vi.fn<StorageDriveClient["change"]>(async (token, ref, change) =>
      changeOf(store, ref, change),
    ),
    copy: vi.fn<StorageDriveClient["copy"]>(async (token, ref, target) => ({
      ok: true,
      value: entryOf(`copy-${ref}`, {
        name: target.name,
        parentRef: target.parentId,
      }),
    })),
    createFolder: vi.fn<StorageDriveClient["createFolder"]>(
      async (token, input) => ({
        ok: true,
        value: folderOf(`new-${input.name}`, input.parentId, {
          name: input.name,
        }),
      }),
    ),
    download: vi.fn<StorageDriveClient["download"]>(async () => FAILURE),
    export: vi.fn<StorageDriveClient["export"]>(async () => FAILURE),
    failQueryCall: listing.failCall,
    listSharedDrives: vi.fn<StorageDriveClient["listSharedDrives"]>(
      async () => FAILURE,
    ),
    query: vi.fn<StorageDriveClient["query"]>(listing.query),
    readQuota: vi.fn<StorageDriveClient["readQuota"]>(async () => FAILURE),
    remove: vi.fn<StorageDriveClient["remove"]>(async () => ({
      ok: true,
      value: null,
    })),
    replaceContent: vi.fn<StorageDriveClient["replaceContent"]>(
      async (token, ref) => ({
        ok: true,
        value: entryOf(ref, { version: "2" }),
      }),
    ),
    stat: vi.fn<StorageDriveClient["stat"]>(async (token, ref) => {
      const found = store.get(ref);

      return found
        ? { ok: true, value: found }
        : { ...FAILURE, code: "not_found" };
    }),
    upload: vi.fn<StorageDriveClient["upload"]>(async (token, upload) => ({
      ok: true,
      value: entryOf(`up-${upload.name}`, {
        name: upload.name,
        parentRef: upload.parentId,
      }),
    })),
  };
}

function connectionOf(
  scopes: readonly string[] = GOOGLE_DRIVE_WRITE_SCOPES,
): FakeConnection {
  return {
    access: vi.fn<StorageConnection["access"]>(async () => ({
      accessToken: "token",
      accountEmail: null,
      grantedScopes: scopes,
      ok: true,
      permissionId: "perm",
    })),
  };
}

function writerOf(
  entries: readonly StorageEntry[] = DEFAULT_ENTRIES,
  scopes: readonly string[] = GOOGLE_DRIVE_WRITE_SCOPES,
): {
  readonly connection: FakeConnection;
  readonly drive: FakeDrive;
  readonly writer: StorageFileWriter;
} {
  const drive = fakeDrive(entries);
  const connection = connectionOf(scopes);

  return {
    connection,
    drive,
    writer: new StorageFileWriter(
      connection,
      drive,
      new StorageConfirmations(),
    ),
  };
}

function tokenOf(result: StorageResult<unknown>): string {
  if (result.ok || !result.error.confirmation) {
    throw new Error("The result carries no confirmation.");
  }

  return result.error.confirmation.token;
}

function codeOf(result: StorageResult<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

const ENTRIES: readonly StorageEntry[] = [
  ...DEFAULT_ENTRIES,
  entryOf("same", { name: "a.txt", parentRef: "dst" }),
  folderOf("sub", "dir"),
  entryOf("child", { parentRef: "sub", sizeBytes: 10 }),
  folderOf("inner", "sub"),
  folderOf("base", null),
  entryOf("orphan", { parentRef: "ghost" }),
  entryOf("bin", { isExplicitlyTrashed: true, isTrashed: true }),
  entryOf("binChild", { isTrashed: true }),
];

function unusable(): {
  readonly ok: false;
  readonly problem: null;
  readonly state: "unavailable";
} {
  return { ok: false, problem: null, state: "unavailable" } as const;
}

describe("StorageFileWriter.trash", () => {
  const request = { confirmation: null, ref: "file1", userId: USER } as const;

  it("trashes a file without confirmation", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    expect(await writer.trash(request)).toMatchObject({
      ok: true,
      value: { isTrashed: true },
    });
    expect(drive.change).toHaveBeenCalledWith("token", "file1", {
      isTrashed: true,
    });
  });

  it("trashes a folder only after its scope was confirmed", async () => {
    const { writer } = writerOf(ENTRIES);
    const first = await writer.trash({ ...request, ref: "sub" });

    expect(first).toMatchObject({
      error: {
        code: "confirmation_required",
        confirmation: {
          scope: {
            fileCount: 1,
            folderCount: 1,
            isTruncated: false,
            totalBytes: 10,
          },
        },
      },
    });
    expect(
      await writer.trash({
        ...request,
        confirmation: tokenOf(first),
        ref: "sub",
      }),
    ).toMatchObject({ ok: true, value: { isTrashed: true } });
  });

  it("refuses unusable sessions, entries and failed Drive calls", async () => {
    const { connection, drive, writer } = writerOf(ENTRIES);

    connection.access.mockResolvedValueOnce(unusable());
    expect(codeOf(await writer.trash(request))).toBe("connection_unavailable");
    expect(codeOf(await writer.trash({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
    expect(codeOf(await writer.trash({ ...request, ref: "base" }))).toBe(
      "unsupported_operation",
    );
    drive.change.mockResolvedValueOnce(FAILURE);
    expect(codeOf(await writer.trash(request))).toBe("provider_unreachable");
  });

  it("passes on a failed scope count", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    drive.failQueryCall(1);
    expect(codeOf(await writer.trash({ ...request, ref: "sub" }))).toBe(
      "provider_unreachable",
    );
  });
});

describe("StorageFileWriter.restore", () => {
  const request = { ref: "bin", userId: USER } as const;

  it("restores an entry trashed itself", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.restore(request))).toBe("ok");
    expect(drive.change).toHaveBeenCalledWith("token", "bin", {
      isTrashed: false,
    });
  });

  it("refuses everything else", async () => {
    const { connection, drive, writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.restore({ ...request, ref: "a b" }))).toBe(
      "invalid_reference",
    );
    connection.access.mockResolvedValueOnce(unusable());
    expect(codeOf(await writer.restore(request))).toBe(
      "connection_unavailable",
    );
    expect(codeOf(await writer.restore({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
    expect(codeOf(await writer.restore({ ...request, ref: "file1" }))).toBe(
      "not_trashed",
    );
    expect(codeOf(await writer.restore({ ...request, ref: "binChild" }))).toBe(
      "unsupported_operation",
    );
    drive.change.mockResolvedValueOnce(FAILURE);
    expect(codeOf(await writer.restore(request))).toBe("provider_unreachable");
  });
});

describe("StorageFileWriter.deletePermanently", () => {
  const request = { confirmation: null, ref: "file1", userId: USER } as const;

  it("deletes a file after a confirmation", async () => {
    const { drive, writer } = writerOf(ENTRIES);
    const first = await writer.deletePermanently(request);

    expect(codeOf(first)).toBe("confirmation_required");
    expect(
      await writer.deletePermanently({
        ...request,
        confirmation: tokenOf(first),
      }),
    ).toEqual({
      ok: true,
      value: { name: "a.txt", ref: "file1", scope: null },
    });
    expect(drive.remove).toHaveBeenCalledWith("token", "file1");
  });

  it("reports the scope of a deleted folder", async () => {
    const { writer } = writerOf(ENTRIES);
    const first = await writer.deletePermanently({ ...request, ref: "sub" });
    const result = await writer.deletePermanently({
      ...request,
      confirmation: tokenOf(first),
      ref: "sub",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { scope: { fileCount: 1, folderCount: 1 } },
    });
  });

  it("refuses an invalid confirmation", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(
      codeOf(
        await writer.deletePermanently({ ...request, confirmation: "bogus" }),
      ),
    ).toBe("confirmation_invalid");
  });

  it("refuses bad references, sessions and entries", async () => {
    const { connection, writer } = writerOf(ENTRIES);

    expect(
      codeOf(await writer.deletePermanently({ ...request, ref: "a b" })),
    ).toBe("invalid_reference");
    expect(
      codeOf(await writer.deletePermanently({ ...request, ref: "root" })),
    ).toBe("invalid_reference");
    connection.access.mockResolvedValueOnce(unusable());
    expect(codeOf(await writer.deletePermanently(request))).toBe(
      "connection_unavailable",
    );
    expect(
      codeOf(await writer.deletePermanently({ ...request, ref: "nope" })),
    ).toBe("not_found");
    expect(
      codeOf(await writer.deletePermanently({ ...request, ref: "base" })),
    ).toBe("unsupported_operation");
  });

  it("passes on a failed removal", async () => {
    const { drive, writer } = writerOf(ENTRIES);
    const first = await writer.deletePermanently(request);

    drive.remove.mockResolvedValueOnce(FAILURE);
    expect(
      codeOf(
        await writer.deletePermanently({
          ...request,
          confirmation: tokenOf(first),
        }),
      ),
    ).toBe("provider_unreachable");
  });
});

describe("StorageFileWriter.confirm", () => {
  const request = { action: "delete", ref: "file1", userId: USER } as const;

  it("issues a confirmation for a file", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(await writer.confirm(request)).toMatchObject({
      ok: true,
      value: { action: "delete", scope: null, target: { ref: "file1" } },
    });
  });

  it("counts the scope of a folder", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(await writer.confirm({ ...request, ref: "sub" })).toMatchObject({
      ok: true,
      value: { scope: { fileCount: 1, folderCount: 1, totalBytes: 10 } },
    });
  });

  it("refuses bad references, sessions, entries and scope failures", async () => {
    const { connection, drive, writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.confirm({ ...request, ref: "a b" }))).toBe(
      "invalid_reference",
    );
    connection.access.mockResolvedValueOnce(unusable());
    expect(codeOf(await writer.confirm(request))).toBe(
      "connection_unavailable",
    );
    expect(codeOf(await writer.confirm({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
    drive.failQueryCall(1);
    expect(codeOf(await writer.confirm({ ...request, ref: "sub" }))).toBe(
      "provider_unreachable",
    );
  });
});
