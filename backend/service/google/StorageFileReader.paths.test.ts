import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { StorageFileReader } from "./StorageFileReader";

import type { DriveItemFailure } from "@/backend/google/GoogleDriveItemsClient";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";
import type { StorageDriveClient, StorageSession } from "./StorageFileSupport";

function entryOf(overrides: Partial<StorageEntry> = {}): StorageEntry {
  return {
    ref: "e1",
    name: "Name",
    isFolder: true,
    mimeType: "application/vnd.google-apps.folder",
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

const SESSION: StorageSession = { accessToken: "tok", canWrite: false };

type DriveMethod = "query" | "stat" | "listSharedDrives";

interface Setup {
  readonly drive: Record<DriveMethod, Mock>;
  readonly reader: StorageFileReader;
}

function setup(isConnected = true): Setup {
  const drive = {
    stat: vi.fn(),
    query: vi.fn(),
    listSharedDrives: vi.fn(),
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

function children(entries: StorageEntry[]): {
  ok: true;
  value: { entries: StorageEntry[]; nextPageToken: null };
} {
  return { ok: true, value: { entries, nextPageToken: null } };
}

describe("StorageFileReader.readablePath", () => {
  it("names a path inside My Drive", async () => {
    const { drive, reader } = setup();
    drive.stat
      .mockResolvedValueOnce({
        ok: true,
        value: entryOf({ ref: "p", name: "Ordner", parentRef: "r" }),
      })
      .mockResolvedValueOnce({ ok: true, value: entryOf({ ref: "r" }) });

    expect(
      await reader.readablePath(
        SESSION,
        entryOf({ name: "Datei", parentRef: "p" }),
      ),
    ).toBe("/Ordner/Datei");
  });

  it("starts a shared drive path with the drive name", async () => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValueOnce({
      ok: true,
      value: entryOf({ ref: "d1", name: "Team", driveRef: "d1" }),
    });

    expect(
      await reader.readablePath(
        SESSION,
        entryOf({ name: "Datei", parentRef: "d1", driveRef: "d1" }),
      ),
    ).toBe("/shared-drives/Team/Datei");
  });

  it("treats a root inside a shared drive that is not the drive as a plain root", async () => {
    const { reader } = setup();

    expect(
      await reader.readablePath(
        SESSION,
        entryOf({ name: "X", ref: "a", driveRef: "d1" }),
      ),
    ).toBe("/");
  });

  it("marks parents that are not visible", async () => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValueOnce(FAILURE);

    expect(
      await reader.readablePath(
        SESSION,
        entryOf({ name: "Datei", parentRef: "p" }),
      ),
    ).toBe("…/Datei");
  });

  it("stops at the maximum depth", async () => {
    const { drive, reader } = setup();
    drive.stat.mockImplementation(async () => ({
      ok: true,
      value: entryOf({ name: "loop", parentRef: "loop" }),
    }));

    const path = await reader.readablePath(
      SESSION,
      entryOf({ name: "start", parentRef: "loop" }),
    );

    expect(path.startsWith("…/loop/")).toBe(true);
    expect(drive.stat).toHaveBeenCalledTimes(30);
  });
});

describe("StorageFileReader.resolvePath", () => {
  it.each([
    "relative",
    `/${"a".repeat(4096)}`,
    `/${Array.from({ length: 31 }, () => "a").join("/")}`,
    "/a/../b",
    "/a/./b",
  ])("rejects the path %#", async (path) => {
    expect(await setup().reader.resolvePath(path)).toMatchObject({
      error: { code: "invalid_path" },
    });
  });

  it("fails without a connection", async () => {
    expect(await setup(false).reader.resolvePath("/a")).toMatchObject({
      error: { code: "connection_unavailable" },
    });
  });

  it("resolves the root for an empty path", async () => {
    const { drive, reader } = setup();
    const root = entryOf({ ref: "root" });
    drive.stat.mockResolvedValue({ ok: true, value: root });

    expect(await reader.resolvePath("/")).toEqual({
      ok: true,
      value: { entry: root, path: "/" },
    });
  });

  it("fails when the root cannot be read", async () => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValue(FAILURE);

    expect(await reader.resolvePath("/a")).toMatchObject({ ok: false });
  });

  it("walks the steps below My Drive", async () => {
    const { drive, reader } = setup();
    const file = entryOf({
      ref: "f",
      name: "b",
      isFolder: false,
      parentRef: "a",
    });
    const known = new Map<string, StorageEntry>([
      ["root", entryOf({ ref: "root" })],
      ["a", entryOf({ ref: "a", name: "a", parentRef: "root" })],
      ["f", file],
    ]);
    drive.stat.mockImplementation(async (token: string, ref: string) => ({
      ok: token === "tok",
      value: known.get(ref),
    }));
    drive.query
      .mockResolvedValueOnce(
        children([entryOf({ ref: "a", name: "a", parentRef: "root" })]),
      )
      .mockResolvedValueOnce(children([file]));

    expect(await reader.resolvePath("/a/b")).toEqual({
      ok: true,
      value: { entry: file, path: "/a/b" },
    });
    expect(drive.query).toHaveBeenNthCalledWith(1, "tok", {
      driveId: null,
      pageSize: 20,
      pageToken: null,
      query: "'root' in parents and name = 'a' and trashed = false",
    });
  });
});

describe("StorageFileReader.resolvePath failures", () => {
  it("reports step failures", async () => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValue({ ok: true, value: entryOf({ ref: "root" }) });
    drive.query.mockResolvedValueOnce(FAILURE);

    expect(await reader.resolvePath("/a")).toMatchObject({
      error: { code: "not_found" },
    });

    drive.query.mockResolvedValueOnce(children([]));

    expect(await reader.resolvePath("/a")).toMatchObject({
      error: { code: "not_found" },
    });

    const twins = [entryOf({ ref: "x" }), entryOf({ ref: "y" })];
    drive.query.mockResolvedValueOnce(children(twins));

    expect(await reader.resolvePath("/a")).toEqual({
      ok: false,
      error: { code: "ambiguous_path", candidates: twins },
    });
  });

  it("refuses to descend into a file", async () => {
    const { drive, reader } = setup();
    drive.stat.mockResolvedValue({ ok: true, value: entryOf({ ref: "root" }) });
    drive.query.mockResolvedValueOnce(
      children([entryOf({ ref: "f", isFolder: false })]),
    );

    expect(await reader.resolvePath("/a/b")).toMatchObject({
      error: { code: "not_folder" },
    });
  });
});

describe("StorageFileReader.resolvePath in shared drives", () => {
  it("needs a drive name", async () => {
    expect(await setup().reader.resolvePath("/shared-drives")).toMatchObject({
      error: { code: "invalid_path" },
    });
  });

  it("fails when the drives cannot be listed", async () => {
    const { drive, reader } = setup();
    drive.listSharedDrives.mockResolvedValue(FAILURE);

    expect(await reader.resolvePath("/shared-drives/T")).toMatchObject({
      ok: false,
    });
  });

  it("reports a missing and an ambiguous drive", async () => {
    const { drive, reader } = setup();
    drive.listSharedDrives.mockResolvedValueOnce(children([]));

    expect(await reader.resolvePath("/shared-drives/T")).toMatchObject({
      error: { code: "not_found" },
    });

    const twins = [
      entryOf({ ref: "d1", name: "T" }),
      entryOf({ ref: "d2", name: "T" }),
    ];
    drive.listSharedDrives.mockResolvedValueOnce(children(twins));

    expect(await reader.resolvePath("/shared-drives/T")).toEqual({
      ok: false,
      error: { code: "ambiguous_path", candidates: twins },
    });
  });

  it("resolves the drive itself and a child of it", async () => {
    const { drive, reader } = setup();
    const shared = entryOf({ ref: "d1", name: "T", driveRef: "d1" });
    drive.listSharedDrives.mockImplementation(async () => children([shared]));
    drive.stat.mockResolvedValue({ ok: true, value: shared });

    expect(await reader.resolvePath("/shared-drives/T")).toEqual({
      ok: true,
      value: { entry: shared, path: "/shared-drives/T" },
    });

    drive.stat.mockResolvedValueOnce({ ok: true, value: shared });
    drive.query.mockResolvedValueOnce(children([shared]));

    expect(await reader.resolvePath("/shared-drives/T/c")).toMatchObject({
      ok: true,
    });
  });

  it("fails when the drive root cannot be read", async () => {
    const { drive, reader } = setup();
    drive.listSharedDrives.mockResolvedValue(
      children([entryOf({ ref: "d1", name: "T" })]),
    );
    drive.stat.mockResolvedValue(FAILURE);

    expect(await reader.resolvePath("/shared-drives/T")).toMatchObject({
      ok: false,
    });
  });
});
