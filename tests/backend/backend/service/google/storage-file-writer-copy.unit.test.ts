import { describe, expect, it } from "vitest";

import {
  TOKEN,
  USER,
  codeOf,
  createWriter,
  makeEntry,
  refusal,
  valueOf,
} from "./storage-file-writer-harness";

import type { StorageFileWriter } from "@/backend/service/google/StorageFileWriter";

const DOCS = makeEntry("docs", { isFolder: true, name: "Docs" });
const ARCHIVE = makeEntry("archive", { isFolder: true, name: "Archive" });
const REPORT = makeEntry("report", { name: "report.pdf", parentRef: "docs" });

function copyRequest(
  overrides: Partial<Parameters<StorageFileWriter["copy"]>[0]> = {},
): Parameters<StorageFileWriter["copy"]>[0] {
  return {
    name: null,
    onConflict: "fail",
    ref: "report",
    targetParentRef: "archive",
    userId: USER,
    ...overrides,
  };
}

describe("StorageFileWriter copy of a file", () => {
  it("copies into the target folder under the original name", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, REPORT]);
    const copy = valueOf(await writer.copy(copyRequest()));

    expect(copy.copiedCount).toBe(1);
    expect(copy.entry.name).toBe("report.pdf");
    expect(drive.calls.copy).toHaveBeenCalledWith(TOKEN, "report", {
      name: "report.pdf",
      parentId: "archive",
    });
  });

  it("copies next to the original under a wanted name", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);

    valueOf(
      await writer.copy(
        copyRequest({ name: " kopie.pdf ", targetParentRef: null }),
      ),
    );

    expect(drive.calls.copy).toHaveBeenCalledWith(TOKEN, "report", {
      name: "kopie.pdf",
      parentId: "docs",
    });
  });

  it("refuses an unusable name, the overwrite policy and a copy of the root", async () => {
    const { writer } = createWriter([DOCS, REPORT]);

    expect(codeOf(await writer.copy(copyRequest({ name: "a/b" })))).toBe(
      "invalid_request",
    );
    expect(
      codeOf(await writer.copy(copyRequest({ onConflict: "overwrite" }))),
    ).toBe("invalid_request");
    expect(
      codeOf(
        await writer.copy(copyRequest({ ref: "root", targetParentRef: null })),
      ),
    ).toBe("unsupported_operation");
  });

  it("fails for a missing original or a target that is no folder", async () => {
    const { writer } = createWriter([DOCS, ARCHIVE, REPORT]);

    expect(codeOf(await writer.copy(copyRequest({ ref: "gone" })))).toBe(
      "not_found",
    );
    expect(
      codeOf(await writer.copy(copyRequest({ targetParentRef: "report" }))),
    ).toBe("not_folder");
  });

  it("fails on a taken name unless both are kept", async () => {
    const { drive, writer } = createWriter([
      DOCS,
      ARCHIVE,
      REPORT,
      makeEntry("taken", { name: "report.pdf", parentRef: "archive" }),
    ]);

    expect(codeOf(await writer.copy(copyRequest()))).toBe("name_conflict");

    valueOf(await writer.copy(copyRequest({ onConflict: "keep_both" })));

    expect(drive.calls.copy.mock.calls[0]?.[2]).toEqual({
      name: "report (2).pdf",
      parentId: "archive",
    });
  });

  it("translates a refused copy", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, REPORT]);

    drive.calls.copy.mockResolvedValueOnce(refusal("provider_forbidden"));

    expect(codeOf(await writer.copy(copyRequest()))).toBe("provider_forbidden");
  });
});

describe("StorageFileWriter copy of a folder", () => {
  const SUB = makeEntry("sub", {
    isFolder: true,
    name: "Sub",
    parentRef: "docs",
  });
  const INNER = makeEntry("inner", { name: "inner.txt", parentRef: "sub" });

  it("copies the tree entry by entry and counts the created entries", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, SUB, REPORT, INNER]);
    const copy = valueOf(
      await writer.copy(copyRequest({ name: "Docs 2", ref: "docs" })),
    );

    expect(copy.copiedCount).toBe(4);
    expect(copy.entry.name).toBe("Docs 2");
    expect(
      drive.calls.createFolder.mock.calls.map((call) => call[1].name),
    ).toEqual(["Docs 2", "Sub"]);
    expect(drive.calls.copy).toHaveBeenCalledTimes(2);
  });

  it("refuses to copy a folder into itself", async () => {
    const { drive, writer } = createWriter([DOCS, SUB]);
    const result = await writer.copy(
      copyRequest({ ref: "docs", targetParentRef: "sub" }),
    );

    expect(codeOf(result)).toBe("invalid_request");
    expect(drive.calls.createFolder).not.toHaveBeenCalled();
  });
});
