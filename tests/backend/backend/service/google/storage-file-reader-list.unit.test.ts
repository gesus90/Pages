import { describe, expect, it } from "vitest";

import { STORAGE_PAGE_SIZE_LIMIT } from "@/backend/service/google/StorageFileReader";

import {
  ROOT,
  codeOf,
  createConnection,
  createReader,
  makeEntry,
  ok,
  pageOf,
  refusal,
  scriptEntries,
  valueOf,
} from "./storage-file-reader-harness";

import type { StorageListRequest } from "@/backend/service/google/StorageFileReader";

function listRequest(
  overrides: Partial<StorageListRequest> = {},
): StorageListRequest {
  return {
    isTrash: false,
    pageSize: null,
    pageToken: null,
    ref: "root",
    ...overrides,
  };
}

describe("StorageFileReader.list of a folder", () => {
  it("lists the live children of the folder with the folder itself", async () => {
    const { drive, reader } = createReader();
    const child = makeEntry("child");

    scriptEntries(drive, [{ ...ROOT, driveRef: "drive-1" }]);
    drive.query.mockResolvedValue(ok(pageOf([child], "next")));

    const listing = valueOf(
      await reader.list(listRequest({ pageSize: 25, pageToken: "token" })),
    );

    expect(listing.entries).toEqual([child]);
    expect(listing.nextPageToken).toBe("next");
    expect(listing.folder?.ref).toBe("root");
    expect(drive.query).toHaveBeenCalledWith("access-token", {
      driveId: "drive-1",
      pageSize: 25,
      pageToken: "token",
      query: "'root' in parents and trashed = false",
    });
  });

  it.each([
    [null, 100],
    [0, 100],
    [-4, 100],
    [2.5, 100],
    [5000, STORAGE_PAGE_SIZE_LIMIT],
    [1000, 1000],
    [1, 1],
  ])("turns the requested page size %s into %s", async (requested, used) => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [ROOT]);
    drive.query.mockResolvedValue(ok(pageOf([])));
    await reader.list(listRequest({ pageSize: requested }));

    expect(drive.query.mock.calls[0]?.[1].pageSize).toBe(used);
  });

  it("refuses a reference that is no Drive identifier", async () => {
    const { drive, reader } = createReader();

    expect(codeOf(await reader.list(listRequest({ ref: "a/b" })))).toBe(
      "invalid_reference",
    );
    expect(drive.stat).not.toHaveBeenCalled();
  });

  it("refuses a file, a trashed folder and an unknown folder", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("file1"),
      makeEntry("gone", { isFolder: true, isTrashed: true }),
    ]);

    expect(codeOf(await reader.list(listRequest({ ref: "file1" })))).toBe(
      "not_folder",
    );
    expect(codeOf(await reader.list(listRequest({ ref: "gone" })))).toBe(
      "trashed",
    );
    expect(codeOf(await reader.list(listRequest({ ref: "other" })))).toBe(
      "not_found",
    );
    expect(drive.query).not.toHaveBeenCalled();
  });

  it("translates a refused query into its Storage failure", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [ROOT]);
    drive.query.mockResolvedValue(refusal("provider_unreachable"));

    expect(codeOf(await reader.list(listRequest()))).toBe(
      "provider_unreachable",
    );
  });

  it("reports an unusable connection without calling Drive", async () => {
    const { drive, reader } = createReader(
      createConnection({
        ok: false,
        problem: "access_revoked",
        state: "reauthorization_required",
      }),
    );
    const result = await reader.list(listRequest());

    expect(result).toEqual({
      error: {
        code: "connection_unavailable",
        connectionProblem: "access_revoked",
        connectionState: "reauthorization_required",
      },
      ok: false,
    });
    expect(drive.stat).not.toHaveBeenCalled();
  });
});

describe("StorageFileReader.list of the trash and the shared drives", () => {
  it("lists only the entries put into the trash themselves", async () => {
    const { drive, reader } = createReader();
    const own = makeEntry("own", {
      isExplicitlyTrashed: true,
      isTrashed: true,
    });
    const inherited = makeEntry("inherited", { isTrashed: true });

    drive.query.mockResolvedValue(ok(pageOf([own, inherited], "more")));

    const listing = valueOf(
      await reader.list(listRequest({ isTrash: true, pageSize: 7 })),
    );

    expect(listing).toEqual({
      entries: [own],
      folder: null,
      nextPageToken: "more",
    });
    expect(drive.query).toHaveBeenCalledWith("access-token", {
      driveId: null,
      pageSize: 7,
      pageToken: null,
      query: "trashed = true",
    });
    expect(drive.stat).not.toHaveBeenCalled();
  });

  it("translates a refused trash query", async () => {
    const { drive, reader } = createReader();

    drive.query.mockResolvedValue(refusal("forbidden"));

    expect(codeOf(await reader.list(listRequest({ isTrash: true })))).toBe(
      "forbidden",
    );
  });

  it("lists the shared drives without a folder", async () => {
    const { drive, reader } = createReader();
    const shared = makeEntry("drive-1", { isFolder: true, name: "Team" });

    drive.listSharedDrives.mockResolvedValue(ok(pageOf([shared], "n2")));

    const listing = valueOf(
      await reader.list(
        listRequest({ pageSize: 3, pageToken: "t1", ref: "shared-drives" }),
      ),
    );

    expect(listing).toEqual({
      entries: [shared],
      folder: null,
      nextPageToken: "n2",
    });
    expect(drive.listSharedDrives).toHaveBeenCalledWith("access-token", {
      pageSize: 3,
      pageToken: "t1",
    });
    expect(drive.query).not.toHaveBeenCalled();
  });

  it("names the consent path when the shared-drive scope is missing", async () => {
    const { drive, reader } = createReader();

    drive.listSharedDrives.mockResolvedValue(refusal("provider_scope_missing"));

    const result = await reader.list(listRequest({ ref: "shared-drives" }));

    expect(result).toEqual({
      error: {
        code: "provider_scope_missing",
        consentPath: "/settings/system?googleDriveAccess=write",
      },
      ok: false,
    });
  });

  it("maps a revoked Drive access of a listing to a sign-in state", async () => {
    const { drive, reader } = createReader();

    drive.listSharedDrives.mockResolvedValue(
      refusal("connection_unavailable", "drive_api_disabled"),
    );

    const result = await reader.list(listRequest({ ref: "shared-drives" }));

    expect(result).toEqual({
      error: {
        code: "connection_unavailable",
        connectionProblem: "drive_api_disabled",
        connectionState: "unavailable",
      },
      ok: false,
    });
  });
});

describe("StorageFileReader.search", () => {
  it("searches by escaped name outside the trash", async () => {
    const { drive, reader } = createReader();
    const hit = makeEntry("hit");

    drive.query.mockResolvedValue(ok(pageOf([hit], "next")));

    const page = valueOf(
      await reader.search({
        folderRef: null,
        pageSize: 50,
        pageToken: "t",
        text: "  Tom's \\ file  ",
      }),
    );

    expect(page).toEqual({ entries: [hit], nextPageToken: "next" });
    expect(drive.query).toHaveBeenCalledWith("access-token", {
      driveId: null,
      pageSize: 50,
      pageToken: "t",
      query: "name contains 'Tom\\'s \\\\ file' and trashed = false",
    });
  });

  it("restricts the search to the direct content of a folder", async () => {
    const { drive, reader } = createReader();

    drive.query.mockResolvedValue(ok(pageOf([])));
    await reader.search({
      folderRef: "folder-1",
      pageSize: null,
      pageToken: null,
      text: "plan",
    });

    expect(drive.query.mock.calls[0]?.[1]).toMatchObject({
      pageSize: 100,
      query:
        "name contains 'plan' and trashed = false and 'folder-1' in parents",
    });
  });

  it.each([["   "], ["x".repeat(201)]])(
    "refuses the unusable search text of length %#",
    async (text) => {
      const { drive, reader } = createReader();
      const result = await reader.search({
        folderRef: null,
        pageSize: null,
        pageToken: null,
        text,
      });

      expect(codeOf(result)).toBe("invalid_request");
      expect(drive.query).not.toHaveBeenCalled();
    },
  );

  it("accepts a search text of exactly the maximum length", async () => {
    const { drive, reader } = createReader();

    drive.query.mockResolvedValue(ok(pageOf([])));

    const result = await reader.search({
      folderRef: null,
      pageSize: null,
      pageToken: null,
      text: "x".repeat(200),
    });

    expect(result.ok).toBe(true);
  });

  it("refuses a folder reference that is no Drive identifier", async () => {
    const { drive, reader } = createReader();
    const result = await reader.search({
      folderRef: "x' or '1'='1",
      pageSize: null,
      pageToken: null,
      text: "plan",
    });

    expect(codeOf(result)).toBe("invalid_reference");
    expect(drive.query).not.toHaveBeenCalled();
  });

  it("translates a refused query and an unusable connection", async () => {
    const { drive, reader } = createReader();
    const request = {
      folderRef: null,
      pageSize: null,
      pageToken: null,
      text: "plan",
    };

    drive.query.mockResolvedValue(refusal("provider_unreachable"));

    expect(codeOf(await reader.search(request))).toBe("provider_unreachable");

    const closed = createReader(
      createConnection({ ok: false, problem: null, state: "disconnected" }),
    );

    expect(codeOf(await closed.reader.search(request))).toBe(
      "connection_unavailable",
    );
    expect(closed.drive.query).not.toHaveBeenCalled();
  });
});
