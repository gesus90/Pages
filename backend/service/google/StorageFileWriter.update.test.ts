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

function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

const MAXIMUM_BYTES = 64 * 1024 * 1024;

describe("StorageFileWriter.upload with overwrite", () => {
  const request = {
    bytes: bytesOf(3),
    confirmation: null,
    mimeType: "text/plain",
    name: "a.txt",
    onConflict: "overwrite",
    parentRef: "dir",
    userId: USER,
  } as const;

  it("uploads as new when no file has the name", async () => {
    const { writer } = writerOf();

    const result = await writer.upload({ ...request, name: "fresh.txt" });

    expect(result).toMatchObject({ ok: true, value: { name: "fresh.txt" } });
  });

  it("replaces the file after a confirmation", async () => {
    const { drive, writer } = writerOf();
    const first = await writer.upload(request);

    expect(codeOf(first)).toBe("confirmation_required");

    const second = await writer.upload({
      ...request,
      confirmation: tokenOf(first),
    });

    expect(second).toMatchObject({ ok: true, value: { version: "2" } });
    expect(drive.replaceContent).toHaveBeenCalledWith("token", "file1", {
      bytes: request.bytes,
      mimeType: "text/plain",
    });
  });

  it("refuses an unknown confirmation and issues a new one", async () => {
    const { writer } = writerOf();

    const result = await writer.upload({ ...request, confirmation: "bogus" });

    expect(result).toMatchObject({
      error: {
        code: "confirmation_invalid",
        confirmation: { action: "overwrite" },
      },
      ok: false,
    });
  });

  it("refuses several files, folders and Google documents", async () => {
    const several = writerOf([
      ...DEFAULT_ENTRIES,
      entryOf("file2", { name: "a.txt" }),
    ]);
    const folder = writerOf([
      folderOf("dir"),
      folderOf("same", "dir", { name: "a.txt" }),
    ]);
    const document = writerOf([
      folderOf("dir"),
      entryOf("doc", {
        mimeType: "application/vnd.google-apps.document",
        name: "a.txt",
      }),
    ]);

    expect(codeOf(await several.writer.upload(request))).toBe("name_conflict");
    expect(codeOf(await folder.writer.upload(request))).toBe("is_folder");
    expect(codeOf(await document.writer.upload(request))).toBe(
      "unsupported_operation",
    );
  });

  it("passes on a failed name check and a failed replacement", async () => {
    const first = writerOf();

    first.drive.failQueryCall(1);
    expect(codeOf(await first.writer.upload(request))).toBe(
      "provider_unreachable",
    );

    const second = writerOf();
    const issued = await second.writer.upload(request);

    second.drive.replaceContent.mockResolvedValueOnce(FAILURE);
    expect(
      codeOf(
        await second.writer.upload({
          ...request,
          confirmation: tokenOf(issued),
        }),
      ),
    ).toBe("provider_unreachable");
  });
});

describe("StorageFileWriter.update", () => {
  const request = {
    bytes: bytesOf(2),
    confirmation: null,
    mimeType: "text/plain",
    ref: "file1",
    userId: USER,
  } as const;

  it("replaces the bytes after a confirmation", async () => {
    const { writer } = writerOf();
    const first = await writer.update(request);

    expect(codeOf(first)).toBe("confirmation_required");
    expect(
      await writer.update({ ...request, confirmation: tokenOf(first) }),
    ).toMatchObject({ ok: true, value: { version: "2" } });
  });

  it("refuses oversized content", async () => {
    const { writer } = writerOf();

    expect(
      codeOf(
        await writer.update({ ...request, bytes: bytesOf(MAXIMUM_BYTES + 1) }),
      ),
    ).toBe("too_large");
  });

  it("refuses folders, Google documents and unknown files", async () => {
    const { writer } = writerOf([
      ...DEFAULT_ENTRIES,
      entryOf("doc", { mimeType: "application/vnd.google-apps.sheet" }),
    ]);

    expect(codeOf(await writer.update({ ...request, ref: "dir" }))).toBe(
      "is_folder",
    );
    expect(codeOf(await writer.update({ ...request, ref: "doc" }))).toBe(
      "unsupported_operation",
    );
    expect(codeOf(await writer.update({ ...request, ref: "nope" }))).toBe(
      "not_found",
    );
  });

  it("passes on a failed replacement and an unusable connection", async () => {
    const { connection, drive, writer } = writerOf();
    const issued = await writer.update(request);

    drive.replaceContent.mockResolvedValueOnce(FAILURE);
    expect(
      codeOf(
        await writer.update({ ...request, confirmation: tokenOf(issued) }),
      ),
    ).toBe("provider_unreachable");
    connection.access.mockResolvedValueOnce({
      ok: false,
      problem: null,
      state: "unavailable",
    });
    expect(codeOf(await writer.update(request))).toBe("connection_unavailable");
  });
});
