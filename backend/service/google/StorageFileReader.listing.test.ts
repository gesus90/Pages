import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import {
  STORAGE_PAGE_SIZE_LIMIT,
  StorageFileReader,
} from "./StorageFileReader";

import type { DriveItemFailure } from "@/backend/google/GoogleDriveItemsClient";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";
import type { StorageDriveClient } from "./StorageFileSupport";

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

const FAILURE: DriveItemFailure = {
  ok: false,
  code: "not_found",
  connectionProblem: null,
};

type DriveMethod = "query" | "stat" | "listSharedDrives" | "readQuota";

interface Setup {
  readonly drive: Record<DriveMethod, Mock>;
  readonly reader: StorageFileReader;
}

function setup(isConnected = true): Setup {
  const drive = {
    query: vi.fn(),
    stat: vi.fn(),
    listSharedDrives: vi.fn(),
    readQuota: vi.fn(),
  };
  const connection = {
    access: vi.fn(async () =>
      isConnected
        ? {
            ok: true as const,
            accessToken: "tok",
            permissionId: "p",
            accountEmail: null,
            grantedScopes: [],
          }
        : { ok: false as const, state: "unavailable" as const, problem: null },
    ),
  };
  const reader = new StorageFileReader(
    connection,
    drive as unknown as StorageDriveClient,
  );

  return { drive, reader };
}

const PAGE = { entries: [entryOf()], nextPageToken: null };

describe("StorageFileReader.list", () => {
  it("fails when the connection is unavailable", async () => {
    const { reader } = setup(false);

    expect(
      await reader.list({
        ref: "root",
        isTrash: false,
        pageSize: null,
        pageToken: null,
      }),
    ).toMatchObject({ error: { code: "connection_unavailable" } });
  });

  it("lists a folder with the default page size", async () => {
    const { drive, reader } = setup();
    const folder = entryOf({ ref: "f1", isFolder: true, driveRef: "d1" });
    drive.stat.mockResolvedValue({ ok: true, value: folder });
    drive.query.mockResolvedValue({ ok: true, value: PAGE });

    const result = await reader.list({
      ref: "f1",
      isTrash: false,
      pageSize: null,
      pageToken: "pt",
    });

    expect(result).toEqual({ ok: true, value: { ...PAGE, folder } });
    expect(drive.query).toHaveBeenCalledWith("tok", {
      driveId: "d1",
      pageSize: 100,
      pageToken: "pt",
      query: "'f1' in parents and trashed = false",
    });
  });

  it.each([
    [5, 5],
    [0, 100],
    [-3, 100],
    [2.5, 100],
    [5000, STORAGE_PAGE_SIZE_LIMIT],
  ])("normalizes page size %s to %s", async (requested, expected) => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValue({
      ok: true,
      value: entryOf({ isFolder: true }),
    });
    drive.query.mockResolvedValue({ ok: true, value: PAGE });

    await reader.list({
      ref: "f1",
      isTrash: false,
      pageSize: requested,
      pageToken: null,
    });

    expect(drive.query).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ pageSize: expected }),
    );
  });

  it("returns folder and query failures", async () => {
    const { drive, reader } = setup();
    const request = {
      ref: "f1",
      isTrash: false,
      pageSize: null,
      pageToken: null,
    };
    drive.stat.mockResolvedValueOnce(FAILURE);

    expect(await reader.list(request)).toMatchObject({
      error: { code: "not_found" },
    });

    drive.stat.mockResolvedValueOnce({
      ok: true,
      value: entryOf({ isFolder: true }),
    });
    drive.query.mockResolvedValueOnce(FAILURE);

    expect(await reader.list(request)).toMatchObject({
      error: { code: "not_found" },
    });
  });
});

describe("StorageFileReader.list special listings", () => {
  it("lists only explicitly trashed entries of the trash", async () => {
    const { drive, reader } = setup();
    drive.query.mockResolvedValueOnce({
      ok: true,
      value: {
        entries: [
          entryOf({ ref: "a", isExplicitlyTrashed: true }),
          entryOf({ ref: "b" }),
        ],
        nextPageToken: "n",
      },
    });

    const result = await reader.list({
      ref: "root",
      isTrash: true,
      pageSize: 7,
      pageToken: null,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [entryOf({ ref: "a", isExplicitlyTrashed: true })],
        folder: null,
        nextPageToken: "n",
      },
    });
    expect(drive.query).toHaveBeenCalledWith("tok", {
      driveId: null,
      pageSize: 7,
      pageToken: null,
      query: "trashed = true",
    });

    drive.query.mockResolvedValueOnce(FAILURE);

    expect(
      await reader.list({
        ref: "root",
        isTrash: true,
        pageSize: null,
        pageToken: null,
      }),
    ).toMatchObject({ ok: false });
  });

  it("lists the shared drives", async () => {
    const { drive, reader } = setup();
    const request = {
      ref: "shared-drives",
      isTrash: false,
      pageSize: null,
      pageToken: "t",
    };
    drive.listSharedDrives.mockResolvedValueOnce({ ok: true, value: PAGE });

    expect(await reader.list(request)).toEqual({
      ok: true,
      value: { ...PAGE, folder: null },
    });
    expect(drive.listSharedDrives).toHaveBeenCalledWith("tok", {
      pageSize: 100,
      pageToken: "t",
    });

    drive.listSharedDrives.mockResolvedValueOnce(FAILURE);

    expect(await reader.list(request)).toMatchObject({ ok: false });
  });
});

describe("StorageFileReader.search", () => {
  const base = { folderRef: null, pageSize: null, pageToken: null };

  it("validates text and folder reference", async () => {
    const { reader } = setup();

    expect(await reader.search({ ...base, text: "  " })).toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(
      await reader.search({ ...base, text: "x".repeat(201) }),
    ).toMatchObject({ error: { code: "invalid_request" } });
    expect(
      await reader.search({ ...base, text: "a", folderRef: "a/b" }),
    ).toMatchObject({ error: { code: "invalid_reference" } });
  });

  it("fails without a connection", async () => {
    const { reader } = setup(false);

    expect(await reader.search({ ...base, text: "a" })).toMatchObject({
      error: { code: "connection_unavailable" },
    });
  });

  it("searches everywhere or inside a folder", async () => {
    const { drive, reader } = setup();
    drive.query.mockResolvedValue({ ok: true, value: PAGE });

    expect(await reader.search({ ...base, text: " it's " })).toEqual({
      ok: true,
      value: PAGE,
    });
    expect(drive.query).toHaveBeenLastCalledWith("tok", {
      driveId: null,
      pageSize: 100,
      pageToken: null,
      query: "name contains 'it\\'s' and trashed = false",
    });

    await reader.search({ ...base, text: "a", folderRef: "f1", pageSize: 3 });

    expect(drive.query).toHaveBeenLastCalledWith("tok", {
      driveId: null,
      pageSize: 3,
      pageToken: null,
      query: "name contains 'a' and trashed = false and 'f1' in parents",
    });
  });

  it("returns a query failure", async () => {
    const { drive, reader } = setup();
    drive.query.mockResolvedValue(FAILURE);

    expect(await reader.search({ ...base, text: "a" })).toMatchObject({
      error: { code: "not_found" },
    });
  });
});

describe("StorageFileReader.stat and quota", () => {
  it("rejects an invalid reference and a missing connection", async () => {
    expect(await setup().reader.stat("a/b")).toMatchObject({
      error: { code: "invalid_reference" },
    });
    expect(await setup(false).reader.stat("a")).toMatchObject({
      error: { code: "connection_unavailable" },
    });
  });

  it("returns a Drive failure", async () => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValue(FAILURE);

    expect(await reader.stat("a")).toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("returns the entry with its readable path", async () => {
    const { drive, reader } = setup();
    const folder = entryOf({ ref: "p", name: "Ordner", parentRef: "r" });
    const file = entryOf({ ref: "a", name: "Datei", parentRef: "p" });
    drive.stat
      .mockResolvedValueOnce({ ok: true, value: file })
      .mockResolvedValueOnce({ ok: true, value: folder })
      .mockResolvedValueOnce({ ok: true, value: entryOf({ ref: "r" }) });

    expect(await reader.stat("a")).toEqual({
      ok: true,
      value: { entry: file, path: "/Ordner/Datei" },
    });
  });

  it("reads the quota", async () => {
    const { drive, reader } = setup();
    const reading = {
      usageBytes: 1,
      usageInDriveBytes: null,
      usageInTrashBytes: null,
      limitBytes: null,
    };
    drive.readQuota.mockResolvedValueOnce({ ok: true, value: reading });
    drive.readQuota.mockResolvedValueOnce(FAILURE);

    expect(await reader.quota()).toEqual({ ok: true, value: reading });
    expect(await reader.quota()).toMatchObject({ ok: false });
    expect(await setup(false).reader.quota()).toMatchObject({ ok: false });
  });
});
