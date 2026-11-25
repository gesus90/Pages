import { describe, expect, it, vi } from "vitest";

import { StorageFolderCopier } from "./StorageFolderCopier";

import type { DriveItemFailure } from "@/backend/google/GoogleDriveItemsClient";
import type { Mock } from "vitest";
import type { StorageDriveClient, StorageSession } from "./StorageFileSupport";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";

const SESSION: StorageSession = { accessToken: "token", canWrite: true };

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
    parentRef: null,
    ref,
    sizeBytes: null,
    version: "1",
    webViewLink: null,
    ...overrides,
  };
}

function folderOf(
  ref: string,
  parentRef: string | null = null,
  overrides: Partial<StorageEntry> = {},
): StorageEntry {
  return entryOf(ref, { isFolder: true, parentRef, ...overrides });
}

function failure(): DriveItemFailure {
  return { code: "provider_unreachable", connectionProblem: null, ok: false };
}

interface FakeOptions {
  /** Fails a live listing of this folder. */
  readonly failChildren?: string;
  readonly failCreate?: string;
  readonly failCopy?: string;
  readonly pageLimit?: number;
}

type FakeDrive = {
  readonly [Key in keyof StorageDriveClient]: Mock<StorageDriveClient[Key]>;
} & { readonly created: StorageEntry[] };

function fakeDrive(
  entries: readonly StorageEntry[],
  options: FakeOptions = {},
): FakeDrive {
  const store = new Map(entries.map((entry) => [entry.ref, entry]));
  const created: StorageEntry[] = [];
  const pageLimit = options.pageLimit ?? Number.MAX_SAFE_INTEGER;

  return {
    change: vi.fn<StorageDriveClient["change"]>(async () => failure()),
    copy: vi.fn<StorageDriveClient["copy"]>(async (token, ref, target) => {
      if (target.name === options.failCopy) return failure();

      const copy = entryOf(`copy-${ref}`, {
        name: target.name,
        parentRef: target.parentId,
      });

      created.push(copy);

      return { ok: true, value: copy };
    }),
    created,
    createFolder: vi.fn<StorageDriveClient["createFolder"]>(
      async (token, input) => {
        if (input.name === options.failCreate) return failure();

        const folder = folderOf(`new-${input.name}`, input.parentId, {
          name: input.name,
        });

        created.push(folder);

        return { ok: true, value: folder };
      },
    ),
    download: vi.fn<StorageDriveClient["download"]>(async () => failure()),
    export: vi.fn<StorageDriveClient["export"]>(async () => failure()),
    listSharedDrives: vi.fn<StorageDriveClient["listSharedDrives"]>(async () =>
      failure(),
    ),
    query: vi.fn<StorageDriveClient["query"]>(async (token, request) => {
      const isLive = request.query.includes("trashed = false");

      if (
        options.failChildren !== undefined &&
        isLive &&
        request.query.includes(`'${options.failChildren}'`)
      ) {
        return failure();
      }

      const parent = /^'([^']+)' in parents/.exec(request.query)?.[1];
      const matching = [...store.values()].filter(
        (entry) => entry.parentRef === parent,
      );
      const offset = Number(request.pageToken ?? "0");
      const next = offset + pageLimit;

      return {
        ok: true,
        value: {
          entries: matching.slice(offset, next),
          nextPageToken: next < matching.length ? String(next) : null,
        },
      };
    }),
    readQuota: vi.fn<StorageDriveClient["readQuota"]>(async () => failure()),
    remove: vi.fn<StorageDriveClient["remove"]>(async () => failure()),
    replaceContent: vi.fn<StorageDriveClient["replaceContent"]>(async () =>
      failure(),
    ),
    stat: vi.fn<StorageDriveClient["stat"]>(async (token, ref) => {
      const found = store.get(ref);

      return found ? { ok: true, value: found } : failure();
    }),
    upload: vi.fn<StorageDriveClient["upload"]>(async () => failure()),
  };
}

const SOURCE = folderOf("src", "parent");
const TARGET = folderOf("dst", "parent");

describe("StorageFolderCopier.copyFolder", () => {
  it("copies files and nested folders across pages", async () => {
    const fake = fakeDrive(
      [
        SOURCE,
        entryOf("f1", { parentRef: "src" }),
        folderOf("sub", "src"),
        entryOf("f2", { parentRef: "src" }),
        entryOf("g1", { parentRef: "sub", sizeBytes: 5 }),
      ],
      { pageLimit: 2 },
    );
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { copiedCount: 5, entry: { ref: "new-Copy" } },
    });
    expect(fake.created.map((entry) => entry.name)).toEqual([
      "Copy",
      "f1",
      "sub",
      "g1",
      "f2",
    ]);
    expect(fake.copy).toHaveBeenCalledWith("token", "f1", {
      name: "f1",
      parentId: "new-Copy",
    });
  });

  it("refuses a target inside the source", async () => {
    const fake = fakeDrive([SOURCE, folderOf("inner", "src")]);
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: folderOf("inner", "src"),
    });

    expect(result).toEqual({ error: { code: "invalid_request" }, ok: false });
    expect(fake.createFolder).not.toHaveBeenCalled();
  });

  it("passes on a failed scope count", async () => {
    const fake = fakeDrive([SOURCE]);
    fake.query.mockResolvedValueOnce(failure());
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({
      error: { code: "provider_unreachable" },
      ok: false,
    });
  });

  it("refuses more entries than the copy limit", async () => {
    const files = Array.from({ length: 501 }, (_, index) =>
      entryOf(`file${index}`, { parentRef: "src" }),
    );
    const fake = fakeDrive([SOURCE, ...files]);
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({ error: { code: "too_large" }, ok: false });
    expect(fake.createFolder).not.toHaveBeenCalled();
  });

  it("refuses a truncated scope count", async () => {
    const files = Array.from({ length: 2000 }, (_, index) =>
      entryOf(`file${index}`, { parentRef: "src" }),
    );
    const fake = fakeDrive([SOURCE, ...files]);
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({ error: { code: "too_large" }, ok: false });
  });
});

describe("StorageFolderCopier.copyFolder failures", () => {
  it("fails when the root folder cannot be created", async () => {
    const fake = fakeDrive([SOURCE], { failCreate: "Copy" });
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({
      error: { code: "provider_unreachable" },
      ok: false,
    });
  });

  it("fails when the children cannot be listed", async () => {
    const fake = fakeDrive([SOURCE], { failChildren: "src" });
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({
      error: { code: "provider_unreachable" },
      ok: false,
    });
  });

  it("fails when a file cannot be copied", async () => {
    const fake = fakeDrive([SOURCE, entryOf("f1", { parentRef: "src" })], {
      failCopy: "f1",
    });
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({
      error: { code: "provider_unreachable" },
      ok: false,
    });
  });

  it("fails when a nested folder cannot be created", async () => {
    const fake = fakeDrive([SOURCE, folderOf("sub", "src")], {
      failCreate: "sub",
    });
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({
      error: { code: "provider_unreachable" },
      ok: false,
    });
  });

  it("fails when a nested folder cannot be filled", async () => {
    const fake = fakeDrive(
      [SOURCE, folderOf("sub", "src"), entryOf("g1", { parentRef: "sub" })],
      { failChildren: "sub" },
    );
    const copier = new StorageFolderCopier(fake);

    const result = await copier.copyFolder(SESSION, {
      name: "Copy",
      source: SOURCE,
      target: TARGET,
    });

    expect(result).toEqual({
      error: { code: "provider_unreachable" },
      ok: false,
    });
  });
});

describe("StorageFolderCopier.isWithin", () => {
  it("recognizes the entry itself and its descendants", async () => {
    const fake = fakeDrive([folderOf("a", "b"), folderOf("b", null)]);
    const copier = new StorageFolderCopier(fake);

    expect(await copier.isWithin(SESSION, folderOf("a", "b"), "a")).toBe(true);
    expect(await copier.isWithin(SESSION, folderOf("a", "b"), "b")).toBe(true);
  });

  it("is false at a root and when a parent cannot be read", async () => {
    const fake = fakeDrive([folderOf("b", null)]);
    const copier = new StorageFolderCopier(fake);

    expect(await copier.isWithin(SESSION, folderOf("a", "b"), "x")).toBe(false);
    expect(await copier.isWithin(SESSION, folderOf("a", "gone"), "x")).toBe(
      false,
    );
  });

  it("assumes nesting after too many steps", async () => {
    const chain = Array.from({ length: 40 }, (_, index) =>
      folderOf(`n${index}`, `n${index + 1}`),
    );
    const fake = fakeDrive(chain);
    const copier = new StorageFolderCopier(fake);

    expect(await copier.isWithin(SESSION, folderOf("n0", "n1"), "x")).toBe(
      true,
    );
  });
});
