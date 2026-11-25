import { describe, expect, it, vi } from "vitest";

import { GOOGLE_DRIVE_WRITE_SCOPES } from "@/backend/google/GoogleDriveConfig";

import { StorageBatchWriter } from "./StorageBatchWriter";
import { StorageConfirmations } from "./StorageConfirmations";
import { StorageFileWriter } from "./StorageFileWriter";

import type {
  DriveEntryChange,
  DriveItemResult,
} from "@/backend/google/GoogleDriveItemsClient";
import type { StorageBatchRequest } from "./StorageBatchWriter";
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
  entryOf("file2", { name: "b.txt" }),
  folderOf("sub", "dir"),
  entryOf("child", { parentRef: "sub", sizeBytes: 3 }),
  entryOf("away", { parentRef: "dst" }),
];

function batchOf(scopes?: readonly string[]): {
  readonly batch: StorageBatchWriter;
  readonly connection: FakeConnection;
  readonly drive: FakeDrive;
  readonly writer: StorageFileWriter;
} {
  const { connection, drive, writer } = writerOf(ENTRIES, scopes);

  return {
    batch: new StorageBatchWriter(connection, drive, writer),
    connection,
    drive,
    writer,
  };
}

const REQUEST: StorageBatchRequest = {
  action: "delete",
  refs: ["file1", "file2"],
  sourceRef: "dir",
  targetParentRef: null,
  userId: USER,
};

describe("StorageBatchWriter.run request checks", () => {
  it.each<{ title: string; change: Partial<StorageBatchRequest> }>([
    { title: "an unknown action", change: { action: "rename" } },
    { title: "a missing action", change: { action: null } },
    { title: "missing refs", change: { refs: null } },
    { title: "no refs", change: { refs: [] } },
    {
      title: "too many refs",
      change: { refs: Array.from({ length: 101 }, (_, i) => `r${i}`) },
    },
    { title: "duplicate refs", change: { refs: ["file1", "file1"] } },
    { title: "an invalid ref", change: { refs: ["a b"] } },
    { title: "the My Drive root", change: { refs: ["root"] } },
    { title: "the shared-drive list", change: { refs: ["shared-drives"] } },
    { title: "a missing source", change: { sourceRef: null } },
    { title: "an invalid source", change: { sourceRef: "a b" } },
    {
      title: "the shared-drive list as source",
      change: { sourceRef: "shared-drives" },
    },
    { title: "a target for delete", change: { targetParentRef: "dst" } },
    { title: "a copy without target", change: { action: "copy" } },
    {
      title: "a copy to an invalid target",
      change: { action: "copy", targetParentRef: "a b" },
    },
    {
      title: "a move to the shared-drive list",
      change: { action: "move", targetParentRef: "shared-drives" },
    },
  ])("refuses $title", async ({ change }) => {
    const { batch } = batchOf();

    const result = await batch.run({ ...REQUEST, ...change });

    expect(result).toEqual({ error: { code: "invalid_request" }, ok: false });
  });
});

describe("StorageBatchWriter.run preconditions", () => {
  it("passes on an unusable connection", async () => {
    const { batch, connection } = batchOf();

    connection.access.mockResolvedValueOnce({
      ok: false,
      problem: null,
      state: "unavailable",
    });

    expect(codeOf(await batch.run(REQUEST))).toBe("connection_unavailable");
  });

  it("refuses without a write scope", async () => {
    const { batch } = batchOf([]);

    expect(codeOf(await batch.run(REQUEST))).toBe("provider_scope_missing");
  });

  it("refuses a source that is missing or no folder", async () => {
    const { batch } = batchOf();

    expect(codeOf(await batch.run({ ...REQUEST, sourceRef: "nope" }))).toBe(
      "not_found",
    );
    expect(codeOf(await batch.run({ ...REQUEST, sourceRef: "file1" }))).toBe(
      "not_folder",
    );
  });
});

describe("StorageBatchWriter.run actions", () => {
  it("copies files and keeps both names", async () => {
    const { batch, drive } = batchOf();

    const result = await batch.run({
      ...REQUEST,
      action: "copy",
      targetParentRef: "dst",
    });

    expect(result).toEqual({
      ok: true,
      value: { action: "copy", failures: [], succeeded: 2 },
    });
    expect(drive.copy).toHaveBeenCalledTimes(2);
  });

  it("does not copy folders", async () => {
    const { batch } = batchOf();

    const result = await batch.run({
      ...REQUEST,
      action: "copy",
      refs: ["sub"],
      targetParentRef: "dst",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "copy",
        failures: [{ code: "is_folder", ref: "sub" }],
        succeeded: 0,
      },
    });
  });

  it("moves entries", async () => {
    const { batch, drive } = batchOf();

    const result = await batch.run({
      ...REQUEST,
      action: "move",
      targetParentRef: "dst",
    });

    expect(result).toMatchObject({ ok: true, value: { succeeded: 2 } });
    expect(drive.change).toHaveBeenCalledTimes(2);
  });

  it("trashes files and confirms folders itself", async () => {
    const { batch, drive } = batchOf();

    const result = await batch.run({ ...REQUEST, refs: ["file1", "sub"] });

    expect(result).toEqual({
      ok: true,
      value: { action: "delete", failures: [], succeeded: 2 },
    });
    expect(drive.change).toHaveBeenCalledWith("token", "sub", {
      isTrashed: true,
    });
  });

  it("goes on after a refused entry and names its reason", async () => {
    const { batch } = batchOf();

    const result = await batch.run({
      ...REQUEST,
      refs: ["gone", "away", "file1"],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "delete",
        failures: [
          { code: "not_found", ref: "gone" },
          { code: "invalid_reference", ref: "away" },
        ],
        succeeded: 1,
      },
    });
  });

  it("stops after a code that affects every entry", async () => {
    const { batch, drive } = batchOf();

    drive.failQueryCall(1);

    const result = await batch.run({ ...REQUEST, refs: ["sub", "file1"] });

    expect(result).toEqual({
      ok: true,
      value: {
        action: "delete",
        failures: [
          { code: "provider_unreachable", ref: "sub" },
          { code: "provider_unreachable", ref: "file1" },
        ],
        succeeded: 0,
      },
    });
    expect(drive.change).not.toHaveBeenCalled();
  });
});
