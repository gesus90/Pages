import { describe, expect, it } from "vitest";

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

const TEAM_DRIVE = makeEntry("drive-1", {
  driveRef: "drive-1",
  isFolder: true,
  name: "Team",
  parentRef: null,
});

describe("StorageFileReader.stat and readablePath", () => {
  it("returns the entry with its path through the parent folders", async () => {
    const { drive, reader } = createReader();
    const docs = makeEntry("docs", { isFolder: true, parentRef: "root" });
    const file = makeEntry("file1", { name: "Bericht.txt", parentRef: "docs" });

    scriptEntries(drive, [ROOT, docs, file]);

    const located = valueOf(await reader.stat("file1"));

    expect(located.entry).toBe(file);
    expect(located.path).toBe("/docs/Bericht.txt");
  });

  it("names the root of My Drive `/`", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [ROOT]);

    expect(valueOf(await reader.stat("root")).path).toBe("/");
  });

  it("prefixes the path inside a shared drive with its name", async () => {
    const { drive, reader } = createReader();
    const file = makeEntry("file1", {
      driveRef: "drive-1",
      name: "Plan.txt",
      parentRef: "drive-1",
    });

    scriptEntries(drive, [TEAM_DRIVE, file]);

    expect(valueOf(await reader.stat("file1")).path).toBe(
      "/shared-drives/Team/Plan.txt",
    );
  });

  it("marks a parent the account cannot see with an ellipsis", async () => {
    const { drive, reader } = createReader();
    const file = makeEntry("file1", { name: "Lost.txt", parentRef: "hidden" });

    scriptEntries(drive, [file]);

    expect(valueOf(await reader.stat("file1")).path).toBe("…/Lost.txt");
  });

  it("stops following parents after the maximum path depth", async () => {
    const { drive, reader } = createReader();
    const loopA = makeEntry("loopa", { name: "a", parentRef: "loopb" });
    const loopB = makeEntry("loopb", { name: "b", parentRef: "loopa" });

    scriptEntries(drive, [loopA, loopB]);

    const path = valueOf(await reader.stat("loopa")).path;

    expect(path.startsWith("…/")).toBe(true);
    expect(path.split("/")).toHaveLength(31);
    expect(drive.stat).toHaveBeenCalledTimes(31);
  });

  it("also reads an entry in the trash", async () => {
    const { drive, reader } = createReader();
    const trashed = makeEntry("old", { isTrashed: true, parentRef: "root" });

    scriptEntries(drive, [ROOT, trashed]);

    expect(valueOf(await reader.stat("old")).entry.isTrashed).toBe(true);
  });

  it("refuses an invalid reference and translates a Drive refusal", async () => {
    const { drive, reader } = createReader();

    expect(codeOf(await reader.stat("../x"))).toBe("invalid_reference");
    expect(drive.stat).not.toHaveBeenCalled();

    drive.stat.mockResolvedValue(refusal("forbidden"));

    expect(codeOf(await reader.stat("abc"))).toBe("forbidden");
  });
});

describe("StorageFileReader.resolvePath", () => {
  it.each([
    ["no leading slash", "Ordner/Datei"],
    ["a dot step", "/a/./b"],
    ["a parent step", "/a/../b"],
    ["too many steps", `/${Array.from({ length: 31 }, () => "x").join("/")}`],
    ["too long a path", `/${"x".repeat(4096)}`],
  ])("refuses a path with %s", async (description, path) => {
    const { drive, reader } = createReader();

    expect(codeOf(await reader.resolvePath(path))).toBe("invalid_path");
    expect(drive.stat).not.toHaveBeenCalled();
  });

  it("resolves the root path to My Drive", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [ROOT]);

    const located = valueOf(await reader.resolvePath("//"));

    expect(located.entry.ref).toBe("root");
    expect(located.path).toBe("/");
  });

  it("walks the steps and escapes each name in its query", async () => {
    const { drive, reader } = createReader();
    const docs = makeEntry("docs", { isFolder: true, name: "Tom's" });
    const file = makeEntry("file1", { name: "a.txt", parentRef: "docs" });

    scriptEntries(drive, [ROOT, docs, file]);
    drive.query
      .mockResolvedValueOnce(ok(pageOf([docs])))
      .mockResolvedValueOnce(ok(pageOf([file])));

    const located = valueOf(await reader.resolvePath("/Tom's/a.txt"));

    expect(located.entry.ref).toBe("file1");
    expect(located.path).toBe("/Tom's/a.txt");
    expect(drive.query.mock.calls.map((call) => call[1].query)).toEqual([
      "'root' in parents and name = 'Tom\\'s' and trashed = false",
      "'docs' in parents and name = 'a.txt' and trashed = false",
    ]);
  });

  it("refuses to descend into a file", async () => {
    const { drive, reader } = createReader();
    const file = makeEntry("file1", { name: "a.txt" });

    scriptEntries(drive, [ROOT, file]);
    drive.query.mockResolvedValueOnce(ok(pageOf([file])));

    expect(codeOf(await reader.resolvePath("/a.txt/b"))).toBe("not_folder");
    expect(drive.query).toHaveBeenCalledTimes(1);
  });

  it("reports a missing step as not found", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [ROOT]);
    drive.query.mockResolvedValue(ok(pageOf([])));

    expect(codeOf(await reader.resolvePath("/missing"))).toBe("not_found");
  });

  it("names every candidate of an ambiguous step", async () => {
    const { drive, reader } = createReader();
    const first = makeEntry("one", { name: "Doppelt" });
    const second = makeEntry("two", { name: "Doppelt" });

    scriptEntries(drive, [ROOT]);
    drive.query.mockResolvedValue(ok(pageOf([first, second])));

    const result = await reader.resolvePath("/Doppelt");

    expect(result).toEqual({
      error: { candidates: [first, second], code: "ambiguous_path" },
      ok: false,
    });
  });

  it("translates a refused step query and a missing root", async () => {
    const { drive, reader } = createReader();

    expect(codeOf(await reader.resolvePath("/a"))).toBe("not_found");

    scriptEntries(drive, [ROOT]);
    drive.query.mockResolvedValue(refusal("provider_unreachable"));

    expect(codeOf(await reader.resolvePath("/a"))).toBe("provider_unreachable");
  });
});

describe("StorageFileReader.resolvePath in a shared drive", () => {
  it("resolves below the named shared drive", async () => {
    const { drive, reader } = createReader();
    const file = makeEntry("file1", {
      driveRef: "drive-1",
      name: "Plan.txt",
      parentRef: "drive-1",
    });

    scriptEntries(drive, [TEAM_DRIVE, file]);
    drive.listSharedDrives.mockResolvedValue(
      ok(pageOf([makeEntry("other", { name: "Andere" }), TEAM_DRIVE])),
    );
    drive.query.mockResolvedValue(ok(pageOf([file])));

    const located = valueOf(
      await reader.resolvePath("/shared-drives/Team/Plan.txt"),
    );

    expect(located.entry.ref).toBe("file1");
    expect(located.path).toBe("/shared-drives/Team/Plan.txt");
    expect(drive.listSharedDrives).toHaveBeenCalledWith("access-token", {
      pageSize: 100,
      pageToken: null,
    });
    expect(drive.query.mock.calls[0]?.[1].driveId).toBe("drive-1");
  });

  it("resolves the shared drive itself when no step follows", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [TEAM_DRIVE]);
    drive.listSharedDrives.mockResolvedValue(ok(pageOf([TEAM_DRIVE])));

    const located = valueOf(await reader.resolvePath("/shared-drives/Team"));

    expect(located.entry.ref).toBe("drive-1");
    expect(located.path).toBe("/shared-drives/Team");
  });

  it("needs the name of a shared drive", async () => {
    const { drive, reader } = createReader();

    expect(codeOf(await reader.resolvePath("/shared-drives"))).toBe(
      "invalid_path",
    );
    expect(drive.listSharedDrives).not.toHaveBeenCalled();
  });

  it("reports an unknown shared drive and an ambiguous name", async () => {
    const { drive, reader } = createReader();
    const twin = makeEntry("drive-2", { isFolder: true, name: "Team" });

    drive.listSharedDrives.mockResolvedValue(ok(pageOf([TEAM_DRIVE])));

    expect(codeOf(await reader.resolvePath("/shared-drives/Nope"))).toBe(
      "not_found",
    );

    drive.listSharedDrives.mockResolvedValue(ok(pageOf([TEAM_DRIVE, twin])));

    expect(await reader.resolvePath("/shared-drives/Team")).toEqual({
      error: { candidates: [TEAM_DRIVE, twin], code: "ambiguous_path" },
      ok: false,
    });
  });

  it("translates a refused drive list and an unreadable drive root", async () => {
    const { drive, reader } = createReader();

    drive.listSharedDrives.mockResolvedValue(refusal("provider_scope_missing"));

    expect(codeOf(await reader.resolvePath("/shared-drives/Team"))).toBe(
      "provider_scope_missing",
    );

    drive.listSharedDrives.mockResolvedValue(ok(pageOf([TEAM_DRIVE])));

    expect(codeOf(await reader.resolvePath("/shared-drives/Team"))).toBe(
      "not_found",
    );
  });
});

describe("StorageFileReader path operations without a connection", () => {
  it("report an unusable connection before asking Drive", async () => {
    const { drive, reader } = createReader(
      createConnection({
        ok: false,
        problem: "account_changed",
        state: "reauthorization_required",
      }),
    );

    expect(await reader.stat("file1")).toEqual({
      error: {
        code: "connection_unavailable",
        connectionProblem: "account_changed",
        connectionState: "reauthorization_required",
      },
      ok: false,
    });
    expect(codeOf(await reader.resolvePath("/a"))).toBe(
      "connection_unavailable",
    );
    expect(drive.stat).not.toHaveBeenCalled();
    expect(drive.query).not.toHaveBeenCalled();
  });
});
