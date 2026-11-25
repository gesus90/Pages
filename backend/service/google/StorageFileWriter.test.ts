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

function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

const MAXIMUM_BYTES = 64 * 1024 * 1024;

describe("StorageFileWriter session and name checks", () => {
  it("refuses a name that is not valid", async () => {
    const { writer } = writerOf();

    expect(
      codeOf(
        await writer.createFolder({
          name: " ",
          onConflict: "fail",
          parentRef: "dir",
          userId: USER,
        }),
      ),
    ).toBe("invalid_request");
  });

  it("refuses the overwrite policy for folders", async () => {
    const { writer } = writerOf();

    expect(
      codeOf(
        await writer.createFolder({
          name: "x",
          onConflict: "overwrite",
          parentRef: "dir",
          userId: USER,
        }),
      ),
    ).toBe("invalid_request");
  });

  it("passes on an unusable connection", async () => {
    const { connection, writer } = writerOf();

    connection.access.mockResolvedValueOnce({
      ok: false,
      problem: null,
      state: "unavailable",
    });

    const result = await writer.createFolder({
      name: "x",
      onConflict: "fail",
      parentRef: "dir",
      userId: USER,
    });

    expect(codeOf(result)).toBe("connection_unavailable");
  });

  it("asks for the write consent when the scope is missing", async () => {
    const { writer } = writerOf(DEFAULT_ENTRIES, []);

    const result = await writer.update({
      bytes: bytesOf(1),
      confirmation: null,
      mimeType: "text/plain",
      ref: "file1",
      userId: USER,
    });

    expect(codeOf(result)).toBe("provider_scope_missing");
  });
});

describe("StorageFileWriter.createFolder", () => {
  const request = {
    name: " New ",
    onConflict: "fail",
    parentRef: "dir",
    userId: USER,
  } as const;

  it("creates a folder with the trimmed name", async () => {
    const { drive, writer } = writerOf();

    const result = await writer.createFolder(request);

    expect(result).toMatchObject({ ok: true, value: { name: "New" } });
    expect(drive.createFolder).toHaveBeenCalledWith("token", {
      name: "New",
      parentId: "dir",
    });
  });

  it("fails for a missing or non-folder parent", async () => {
    const { writer } = writerOf();

    expect(
      codeOf(await writer.createFolder({ ...request, parentRef: "nope" })),
    ).toBe("not_found");
    expect(
      codeOf(await writer.createFolder({ ...request, parentRef: "file1" })),
    ).toBe("not_folder");
  });

  it("reports a taken name with the conflicting entries", async () => {
    const { writer } = writerOf();

    const result = await writer.createFolder({ ...request, name: "a.txt" });

    expect(result).toMatchObject({
      error: { code: "name_conflict", conflicts: [{ ref: "file1" }] },
      ok: false,
    });
  });

  it("keeps both names when asked", async () => {
    const { writer } = writerOf();

    const result = await writer.createFolder({
      ...request,
      name: "a.txt",
      onConflict: "keep_both",
    });

    expect(result).toMatchObject({ ok: true, value: { name: "a (2).txt" } });
  });

  it("passes on failures of the name check and the Drive call", async () => {
    const first = writerOf();

    first.drive.failQueryCall(1);
    expect(codeOf(await first.writer.createFolder(request))).toBe(
      "provider_unreachable",
    );

    const second = writerOf();

    second.drive.createFolder.mockResolvedValueOnce(FAILURE);
    expect(codeOf(await second.writer.createFolder(request))).toBe(
      "provider_unreachable",
    );
  });
});

describe("StorageFileWriter.upload", () => {
  const request = {
    bytes: bytesOf(3),
    confirmation: null,
    mimeType: "text/plain",
    name: "new.txt",
    onConflict: "fail",
    parentRef: "dir",
    userId: USER,
  } as const;

  it("uploads a new file", async () => {
    const { drive, writer } = writerOf();

    const result = await writer.upload(request);

    expect(result).toMatchObject({ ok: true, value: { name: "new.txt" } });
    expect(drive.upload).toHaveBeenCalledWith("token", {
      content: request.bytes,
      mimeType: "text/plain",
      name: "new.txt",
      parentId: "dir",
    });
  });

  it("refuses bad names and oversized content", async () => {
    const { writer } = writerOf();

    expect(codeOf(await writer.upload({ ...request, name: "a/b" }))).toBe(
      "invalid_request",
    );

    const large = await writer.upload({
      ...request,
      bytes: bytesOf(MAXIMUM_BYTES + 1),
    });

    expect(large).toMatchObject({
      error: { code: "too_large", limitBytes: MAXIMUM_BYTES },
      ok: false,
    });
  });

  it("passes on connection and parent failures", async () => {
    const { connection, writer } = writerOf();

    expect(codeOf(await writer.upload({ ...request, parentRef: "nope" }))).toBe(
      "not_found",
    );
    connection.access.mockResolvedValueOnce({
      ok: false,
      problem: null,
      state: "unavailable",
    });
    expect(codeOf(await writer.upload(request))).toBe("connection_unavailable");
  });

  it("refuses a taken name, or keeps both", async () => {
    const { writer } = writerOf();
    const taken = { ...request, name: "a.txt" };

    expect(codeOf(await writer.upload(taken))).toBe("name_conflict");
    expect(
      await writer.upload({ ...taken, onConflict: "keep_both" }),
    ).toMatchObject({ ok: true, value: { name: "a (2).txt" } });
  });

  it("passes on a failed name check and a failed upload", async () => {
    const first = writerOf();

    first.drive.failQueryCall(1);
    expect(codeOf(await first.writer.upload(request))).toBe(
      "provider_unreachable",
    );

    const second = writerOf();

    second.drive.upload.mockResolvedValueOnce(FAILURE);
    expect(codeOf(await second.writer.upload(request))).toBe(
      "provider_unreachable",
    );
  });
});
