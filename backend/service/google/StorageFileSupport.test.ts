import { describe, expect, it, vi } from "vitest";

import {
  STORAGE_CONSENT_PATH,
  countFolderScope,
  driveFailure,
  findFreeName,
  findNameConflicts,
  isStorageRef,
  openStorageSession,
  readEntryName,
  readLiveEntry,
  readLiveFolder,
  storageFailure,
  writeRefusal,
} from "./StorageFileSupport";

import type { DriveItemFailure } from "@/backend/google/GoogleDriveItemsClient";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";
import type {
  StorageConnection,
  StorageDriveClient,
  StorageSession,
} from "./StorageFileSupport";

function entryOf(overrides: Partial<StorageEntry> = {}): StorageEntry {
  return {
    ref: "e1",
    name: "Name",
    isFolder: false,
    mimeType: "text/plain",
    isGoogleDocument: false,
    isTrashed: false,
    isExplicitlyTrashed: false,
    modifiedAt: null,
    sizeBytes: null,
    parentRef: null,
    driveRef: null,
    version: null,
    webViewLink: null,
    exportFormats: [],
    ...overrides,
  };
}

function driveOf(query: ReturnType<typeof vi.fn>): StorageDriveClient {
  return { query, stat: vi.fn() } as unknown as StorageDriveClient;
}

const SESSION: StorageSession = { accessToken: "tok", canWrite: true };

function failureOf(
  overrides: Partial<DriveItemFailure> = {},
): DriveItemFailure {
  return {
    ok: false,
    code: "not_found",
    connectionProblem: null,
    ...overrides,
  };
}

describe("storageFailure and driveFailure", () => {
  it("builds a failure with details", () => {
    expect(storageFailure("trashed")).toEqual({
      ok: false,
      error: { code: "trashed" },
    });
    expect(storageFailure("too_large", { limitBytes: 5 })).toEqual({
      ok: false,
      error: { code: "too_large", limitBytes: 5 },
    });
  });

  it("maps sign-in problems to reauthorization_required", () => {
    expect(
      driveFailure(failureOf({ connectionProblem: "access_revoked" })),
    ).toEqual({
      ok: false,
      error: {
        code: "connection_unavailable",
        connectionProblem: "access_revoked",
        connectionState: "reauthorization_required",
      },
    });
  });

  it("maps other connection problems to unavailable", () => {
    const result = driveFailure(
      failureOf({ connectionProblem: "drive_api_disabled" }),
    );

    expect(result).toMatchObject({
      error: { connectionState: "unavailable" },
    });
  });

  it("adds the consent path for a missing scope", () => {
    expect(driveFailure(failureOf({ code: "provider_scope_missing" }))).toEqual(
      {
        ok: false,
        error: {
          code: "provider_scope_missing",
          consentPath: STORAGE_CONSENT_PATH,
        },
      },
    );
  });

  it("passes other codes through", () => {
    expect(driveFailure(failureOf())).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("openStorageSession and writeRefusal", () => {
  it("reports an unusable connection", async () => {
    const connection: StorageConnection = {
      access: vi.fn(async () => ({
        ok: false as const,
        state: "unavailable" as const,
        problem: null,
      })),
    };

    expect(await openStorageSession(connection)).toEqual({
      ok: false,
      error: {
        code: "connection_unavailable",
        connectionProblem: null,
        connectionState: "unavailable",
      },
    });
  });

  it("derives the write right from the granted scopes", async () => {
    const accessWith = (scopes: string[]): StorageConnection => ({
      access: vi.fn(async () => ({
        ok: true as const,
        accessToken: "t",
        permissionId: "p",
        accountEmail: null,
        grantedScopes: scopes,
      })),
    });

    const write = await openStorageSession(
      accessWith(["https://www.googleapis.com/auth/drive"]),
    );
    const read = await openStorageSession(accessWith(["other"]));

    expect(write).toEqual({
      ok: true,
      value: { accessToken: "t", canWrite: true },
    });
    expect(read).toEqual({
      ok: true,
      value: { accessToken: "t", canWrite: false },
    });
  });

  it("refuses a change without the write right", () => {
    expect(writeRefusal(SESSION)).toBeNull();
    expect(writeRefusal({ ...SESSION, canWrite: false })).toEqual({
      ok: false,
      error: {
        code: "provider_scope_missing",
        consentPath: STORAGE_CONSENT_PATH,
      },
    });
  });
});

describe("isStorageRef and readEntryName", () => {
  it("accepts root and Drive identifiers only", () => {
    expect(isStorageRef("root")).toBe(true);
    expect(isStorageRef("abc_-1")).toBe(true);
    expect(isStorageRef("a/b")).toBe(false);
    expect(isStorageRef("")).toBe(false);
  });

  it("trims valid names", () => {
    expect(readEntryName("  Bericht.pdf ")).toBe("Bericht.pdf");
  });

  it.each(["", "  ", ".", "..", "a/b", "a\nb", "x".repeat(256)])(
    "rejects %j",
    (name) => {
      expect(readEntryName(name)).toBeNull();
    },
  );

  it("accepts the longest name", () => {
    expect(readEntryName("x".repeat(255))).toBe("x".repeat(255));
  });
});

describe("readLiveEntry and readLiveFolder", () => {
  it("rejects an invalid reference", async () => {
    const drive = driveOf(vi.fn());

    expect(await readLiveEntry(drive, SESSION, "a/b")).toEqual({
      ok: false,
      error: { code: "invalid_reference" },
    });
    expect(drive.stat).not.toHaveBeenCalled();
  });

  it("translates a Drive failure", async () => {
    const drive = driveOf(vi.fn());
    vi.mocked(drive.stat).mockResolvedValue(failureOf());

    expect(await readLiveEntry(drive, SESSION, "x")).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("refuses a trashed entry and returns a live one", async () => {
    const drive = driveOf(vi.fn());
    vi.mocked(drive.stat)
      .mockResolvedValueOnce({ ok: true, value: entryOf({ isTrashed: true }) })
      .mockResolvedValueOnce({ ok: true, value: entryOf() });

    expect(await readLiveEntry(drive, SESSION, "x")).toMatchObject({
      error: { code: "trashed" },
    });
    expect(await readLiveEntry(drive, SESSION, "x")).toEqual({
      ok: true,
      value: entryOf(),
    });
  });

  it("requires a folder", async () => {
    const drive = driveOf(vi.fn());
    vi.mocked(drive.stat)
      .mockResolvedValueOnce({ ok: true, value: entryOf() })
      .mockResolvedValueOnce({ ok: true, value: entryOf({ isFolder: true }) })
      .mockResolvedValueOnce(failureOf());

    expect(await readLiveFolder(drive, SESSION, "x")).toMatchObject({
      error: { code: "not_folder" },
    });
    expect(await readLiveFolder(drive, SESSION, "x")).toMatchObject({
      ok: true,
    });
    expect(await readLiveFolder(drive, SESSION, "x")).toMatchObject({
      error: { code: "not_found" },
    });
  });
});

describe("findNameConflicts and findFreeName", () => {
  const folder = entryOf({ ref: "f1", isFolder: true, driveRef: "d1" });

  it("queries with an escaped name and leaves out the excepted entry", async () => {
    const query = vi.fn(async () => ({
      ok: true as const,
      value: {
        entries: [entryOf({ ref: "a" }), entryOf({ ref: "b" })],
        nextPageToken: null,
      },
    }));

    const result = await findNameConflicts(driveOf(query), SESSION, {
      folder,
      name: "it's",
      exceptRef: "a",
    });

    expect(result).toEqual({ ok: true, value: [entryOf({ ref: "b" })] });
    expect(query).toHaveBeenCalledWith("tok", {
      driveId: "d1",
      pageSize: 20,
      pageToken: null,
      query: "'f1' in parents and name = 'it\\'s' and trashed = false",
    });
  });

  it("fails when the query fails", async () => {
    const query = vi.fn(async () => failureOf());

    expect(
      await findNameConflicts(driveOf(query), SESSION, { folder, name: "n" }),
    ).toMatchObject({ error: { code: "not_found" } });
    expect(
      await findFreeName(driveOf(query), SESSION, { folder, name: "n" }),
    ).toMatchObject({ error: { code: "not_found" } });
  });

  it("finds the first free numbered name", async () => {
    const query = vi.fn(async () => ({
      ok: true as const,
      value: {
        entries: [entryOf({ name: "bericht (2).pdf" })],
        nextPageToken: null,
      },
    }));

    expect(
      await findFreeName(driveOf(query), SESSION, {
        folder,
        name: "bericht.pdf",
      }),
    ).toEqual({ ok: true, value: "bericht (3).pdf" });
  });

  it("keeps names without a usable extension whole", async () => {
    const query = vi.fn(async () => ({
      ok: true as const,
      value: { entries: [], nextPageToken: null },
    }));

    expect(
      await findFreeName(driveOf(query), SESSION, { folder, name: ".env" }),
    ).toEqual({ ok: true, value: ".env (2)" });
  });

  it("reports a conflict when every number is taken", async () => {
    const entries = Array.from({ length: 998 }, (_, index) =>
      entryOf({ name: `a (${index + 2})` }),
    );
    const query = vi.fn(async () => ({
      ok: true as const,
      value: { entries, nextPageToken: null },
    }));

    expect(
      await findFreeName(driveOf(query), SESSION, { folder, name: "a" }),
    ).toMatchObject({ error: { code: "name_conflict" } });
  });
});

describe("countFolderScope", () => {
  const folder = entryOf({ ref: "root1", isFolder: true, driveRef: "d1" });

  it("counts a tree over pages", async () => {
    const query = vi.fn();
    query
      .mockResolvedValueOnce({
        ok: true,
        value: {
          entries: [
            entryOf({ ref: "sub", isFolder: true }),
            entryOf({ ref: "f1", sizeBytes: 10 }),
          ],
          nextPageToken: "next",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          entries: [entryOf({ ref: "f2", sizeBytes: 5 })],
          nextPageToken: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { entries: [entryOf({ ref: "f3" })], nextPageToken: null },
      });

    expect(await countFolderScope(driveOf(query), SESSION, folder)).toEqual({
      ok: true,
      value: {
        fileCount: 3,
        folderCount: 1,
        totalBytes: 15,
        isTruncated: false,
      },
    });
    expect(query).toHaveBeenNthCalledWith(2, "tok", {
      driveId: "d1",
      pageSize: 1000,
      pageToken: "next",
      query: "'root1' in parents",
    });
  });

  it("fails when a page fails", async () => {
    const query = vi.fn(async () => failureOf());

    expect(await countFolderScope(driveOf(query), SESSION, folder)).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("truncates at the count limit", async () => {
    const entries = Array.from({ length: 2000 }, (_, index) =>
      entryOf({ ref: `f${index}` }),
    );
    const query = vi.fn(async () => ({
      ok: true as const,
      value: { entries, nextPageToken: "more" },
    }));

    expect(await countFolderScope(driveOf(query), SESSION, folder)).toEqual({
      ok: true,
      value: {
        fileCount: 2000,
        folderCount: 0,
        totalBytes: 0,
        isTruncated: true,
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
