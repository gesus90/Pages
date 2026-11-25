import { describe, expect, it, vi } from "vitest";

import { browseAccountStorage } from "./StorageAccountBrowse";

import type { StorageAccessContext } from "./StorageAccessService";
import type { StorageAccountFiles } from "./StorageAccountFiles";
import type { StorageListing } from "./StorageFileReader";
import type {
  StorageEntry,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

function entryOf(ref: string, isFolder: boolean): StorageEntry {
  return {
    ref,
    name: `n-${ref}`,
    isFolder,
    mimeType: isFolder ? "application/vnd.google-apps.folder" : "text/plain",
    isGoogleDocument: false,
    isTrashed: false,
    isExplicitlyTrashed: false,
    modifiedAt: "2030-01-01T00:00:00Z",
    sizeBytes: isFolder ? null : 5,
    parentRef: null,
    driveRef: null,
    version: null,
    webViewLink: "https://example.test/x",
    exportFormats: [],
  };
}

function filesOf(
  listing: StorageResult<StorageListing>,
  isSimulation = false,
): { files: StorageAccountFiles; list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async () => listing);
  const files = {
    isSimulation,
    reader: { list },
  } as unknown as StorageAccountFiles;

  return { files, list };
}

const CONTEXT = {
  grants: [
    { folderRef: "g1", folderName: "One" },
    { folderRef: "g1", folderName: "One again" },
    { folderRef: "g2", folderName: "Two" },
  ],
} as unknown as StorageAccessContext;

const INPUT = { folderId: null, pageToken: null, isFoldersOnly: false };

describe("browseAccountStorage", () => {
  it("lists distinct granted roots for the root folder", async () => {
    const { files, list } = filesOf({
      ok: false,
      error: { code: "not_found" },
    });
    const result = await browseAccountStorage(files, CONTEXT, INPUT);

    expect(list).not.toHaveBeenCalled();
    expect(result.ok && result.value.folder?.items).toHaveLength(2);
    expect(result.ok && result.value.folder?.items[0]?.id).toBe("g1");
    expect(result.ok && result.value.isSimulation).toBe(false);
  });

  it("lists a folder with its entries and path", async () => {
    const { files, list } = filesOf(
      {
        ok: true,
        value: {
          folder: entryOf("f", true),
          entries: [entryOf("a", true), entryOf("b", false)],
          nextPageToken: "next",
        },
      },
      true,
    );
    const result = await browseAccountStorage(files, CONTEXT, {
      folderId: "f",
      pageToken: "p",
      isFoldersOnly: false,
    });

    expect(list).toHaveBeenCalledWith({
      ref: "f",
      isTrash: false,
      pageSize: null,
      pageToken: "p",
    });
    expect(result.ok && result.value.folder?.items).toHaveLength(2);
    expect(result.ok && result.value.folder?.nextPageToken).toBe("next");
    expect(result.ok && result.value.folder?.path).toEqual([
      { id: "f", name: "n-f", role: "folder" },
    ]);
    expect(result.ok && result.value.isSimulation).toBe(true);
  });

  it("keeps only folders when asked", async () => {
    const { files } = filesOf({
      ok: true,
      value: {
        folder: entryOf("f", true),
        entries: [entryOf("a", true), entryOf("b", false)],
        nextPageToken: null,
      },
    });
    const result = await browseAccountStorage(files, CONTEXT, {
      folderId: "f",
      pageToken: null,
      isFoldersOnly: true,
    });

    expect(result.ok && result.value.folder?.items.map((i) => i.id)).toEqual([
      "a",
    ]);
  });

  it("passes a listing failure through", async () => {
    const failure = { ok: false, error: { code: "not_found" } } as const;
    const { files } = filesOf(failure);

    expect(
      await browseAccountStorage(files, CONTEXT, { ...INPUT, folderId: "f" }),
    ).toBe(failure);
  });

  it("refuses a listing without a folder", async () => {
    const { files } = filesOf({
      ok: true,
      value: { folder: null, entries: [], nextPageToken: null },
    });

    expect(
      await browseAccountStorage(files, CONTEXT, { ...INPUT, folderId: "f" }),
    ).toEqual({ ok: false, error: { code: "not_folder" } });
  });
});
