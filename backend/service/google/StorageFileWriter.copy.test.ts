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

describe("StorageFileWriter.copy", () => {
  const request = {
    name: null,
    onConflict: "fail",
    ref: "file1",
    targetParentRef: "dst",
    userId: USER,
  } as const;

  it("copies a file under its name or a new one", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    expect(
      await writer.copy({
        ...request,
        name: " b.txt ",
        onConflict: "keep_both",
      }),
    ).toMatchObject({
      ok: true,
      value: { copiedCount: 1, entry: { name: "b.txt", parentRef: "dst" } },
    });
    expect(drive.copy).toHaveBeenCalledWith("token", "file1", {
      name: "b.txt",
      parentId: "dst",
    });
  });

  it("copies into the folder of the original when none is named", async () => {
    const { writer } = writerOf(ENTRIES);

    const result = await writer.copy({
      ...request,
      name: "b.txt",
      targetParentRef: null,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { entry: { parentRef: "dir" } },
    });
  });

  it("copies a folder tree through the copier", async () => {
    const { writer } = writerOf(ENTRIES);

    const result = await writer.copy({ ...request, ref: "sub" });

    expect(result).toMatchObject({
      ok: true,
      value: { copiedCount: 3, entry: { name: "sub" } },
    });
  });

  it("refuses invalid names and the overwrite policy", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.copy({ ...request, name: "a/b" }))).toBe(
      "invalid_request",
    );
    expect(
      codeOf(await writer.copy({ ...request, onConflict: "overwrite" })),
    ).toBe("invalid_request");
  });

  it("refuses without a write scope and for unknown or rootless entries", async () => {
    expect(codeOf(await writerOf(ENTRIES, []).writer.copy(request))).toBe(
      "provider_scope_missing",
    );

    const { writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.copy({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
    expect(
      codeOf(
        await writer.copy({ ...request, ref: "base", targetParentRef: null }),
      ),
    ).toBe("unsupported_operation");
    expect(
      codeOf(await writer.copy({ ...request, targetParentRef: "file1" })),
    ).toBe("not_folder");
  });

  it("reports a taken name", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.copy(request))).toBe("name_conflict");
    expect(
      await writer.copy({ ...request, onConflict: "keep_both" }),
    ).toMatchObject({ ok: true, value: { entry: { name: "a (2).txt" } } });
  });

  it("passes on a failed name check and a failed Drive copy", async () => {
    const first = writerOf(ENTRIES);

    first.drive.failQueryCall(1);
    expect(codeOf(await first.writer.copy(request))).toBe(
      "provider_unreachable",
    );

    const second = writerOf(ENTRIES);

    second.drive.copy.mockResolvedValueOnce(FAILURE);
    expect(
      codeOf(await second.writer.copy({ ...request, name: "b.txt" })),
    ).toBe("provider_unreachable");
  });
});

describe("StorageFileWriter.move", () => {
  const request = {
    onConflict: "fail",
    ref: "file1",
    targetParentRef: "dst",
    userId: USER,
  } as const;

  it("moves an entry and keeps its name", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    const result = await writer.move({ ...request, ref: "child" });

    expect(result).toMatchObject({ ok: true, value: { parentRef: "dst" } });
    expect(drive.change).toHaveBeenCalledWith("token", "child", {
      addParentId: "dst",
      removeParentId: "sub",
    });
  });

  it("renames on keep_both and refuses a taken name otherwise", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.move(request))).toBe("name_conflict");
    await writer.move({ ...request, onConflict: "keep_both" });
    expect(drive.change).toHaveBeenCalledWith("token", "file1", {
      addParentId: "dst",
      name: "a (2).txt",
      removeParentId: "dir",
    });
  });

  it("changes nothing when the target is the current folder", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    const result = await writer.move({ ...request, targetParentRef: "dir" });

    expect(result).toMatchObject({ ok: true, value: { ref: "file1" } });
    expect(drive.change).not.toHaveBeenCalled();
  });

  it("refuses to nest a folder in itself", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(
      codeOf(
        await writer.move({ ...request, ref: "sub", targetParentRef: "inner" }),
      ),
    ).toBe("invalid_request");
  });

  it("refuses the overwrite policy, a missing scope and bad entries", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(
      codeOf(await writer.move({ ...request, onConflict: "overwrite" })),
    ).toBe("invalid_request");
    expect(codeOf(await writerOf(ENTRIES, []).writer.move(request))).toBe(
      "provider_scope_missing",
    );
    expect(codeOf(await writer.move({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
    expect(codeOf(await writer.move({ ...request, ref: "base" }))).toBe(
      "unsupported_operation",
    );
    expect(
      codeOf(await writer.move({ ...request, targetParentRef: "nope" })),
    ).toBe("not_found");
  });

  it("passes on failed name checks and failed changes", async () => {
    const first = writerOf(ENTRIES);

    first.drive.failQueryCall(1);
    expect(codeOf(await first.writer.move(request))).toBe(
      "provider_unreachable",
    );

    const second = writerOf(ENTRIES);

    second.drive.change.mockResolvedValueOnce(FAILURE);
    expect(codeOf(await second.writer.move({ ...request, ref: "child" }))).toBe(
      "provider_unreachable",
    );
  });
});

describe("StorageFileWriter.rename", () => {
  const request = {
    name: "b.txt",
    onConflict: "fail",
    ref: "file1",
    userId: USER,
  } as const;

  it("renames an entry", async () => {
    const { drive, writer } = writerOf(ENTRIES);

    expect(await writer.rename(request)).toMatchObject({
      ok: true,
      value: { name: "b.txt" },
    });
    expect(drive.change).toHaveBeenCalledWith("token", "file1", {
      name: "b.txt",
    });
  });

  it("does not count the entry itself as a conflict", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(await writer.rename({ ...request, name: "a.txt" })).toMatchObject({
      ok: true,
    });
  });

  it("refuses bad names, the overwrite policy and taken names", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(codeOf(await writer.rename({ ...request, name: ".." }))).toBe(
      "invalid_request",
    );
    expect(
      codeOf(await writer.rename({ ...request, onConflict: "overwrite" })),
    ).toBe("invalid_request");
    expect(
      codeOf(await writer.rename({ ...request, ref: "child", name: "a.txt" })),
    ).toBe("ok");
    expect(
      codeOf(await writer.rename({ ...request, ref: "same", name: "a.txt" })),
    ).toBe("ok");
  });

  it("refuses a name another entry of the folder carries", async () => {
    const { writer } = writerOf([
      ...ENTRIES,
      entryOf("other", { name: "b.txt" }),
    ]);

    expect(codeOf(await writer.rename(request))).toBe("name_conflict");
    expect(
      await writer.rename({ ...request, onConflict: "keep_both" }),
    ).toMatchObject({ ok: true, value: { name: "b (2).txt" } });
  });

  it("refuses unusable sessions, entries and parents", async () => {
    const { writer } = writerOf(ENTRIES);

    expect(codeOf(await writerOf(ENTRIES, []).writer.rename(request))).toBe(
      "provider_scope_missing",
    );
    expect(codeOf(await writer.rename({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
    expect(codeOf(await writer.rename({ ...request, ref: "base" }))).toBe(
      "unsupported_operation",
    );
    expect(codeOf(await writer.rename({ ...request, ref: "orphan" }))).toBe(
      "not_found",
    );
  });

  it("passes on failed name checks and failed changes", async () => {
    const first = writerOf(ENTRIES);

    first.drive.failQueryCall(1);
    expect(codeOf(await first.writer.rename(request))).toBe(
      "provider_unreachable",
    );

    const second = writerOf(ENTRIES);

    second.drive.change.mockResolvedValueOnce(FAILURE);
    expect(codeOf(await second.writer.rename(request))).toBe(
      "provider_unreachable",
    );
  });
});
