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
import type { StorageConflictPolicy } from "@/definition/GoogleDriveFiles";

const DOCS = makeEntry("docs", { isFolder: true, name: "Docs" });
const ARCHIVE = makeEntry("archive", { isFolder: true, name: "Archive" });
const REPORT = makeEntry("report", { name: "report.pdf", parentRef: "docs" });
const TAKEN = makeEntry("taken", { name: "report.pdf", parentRef: "archive" });

function moveRequest(
  overrides: Partial<Parameters<StorageFileWriter["move"]>[0]> = {},
): Parameters<StorageFileWriter["move"]>[0] {
  return {
    onConflict: "fail",
    ref: "report",
    targetParentRef: "archive",
    userId: USER,
    ...overrides,
  };
}

function renameRequest(
  name: string,
  onConflict: StorageConflictPolicy = "fail",
): Parameters<StorageFileWriter["rename"]>[0] {
  return { name, onConflict, ref: "report", userId: USER };
}

describe("StorageFileWriter move", () => {
  it("changes the parent and keeps the name", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, REPORT]);
    const moved = valueOf(await writer.move(moveRequest()));

    expect(moved.parentRef).toBe("archive");
    expect(drive.calls.change).toHaveBeenCalledWith(TOKEN, "report", {
      addParentId: "archive",
      removeParentId: "docs",
    });
  });

  it("returns the entry untouched when it already is in the target folder", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, REPORT]);
    const same = valueOf(
      await writer.move(moveRequest({ targetParentRef: "docs" })),
    );

    expect(same).toEqual(REPORT);
    expect(drive.calls.change).not.toHaveBeenCalled();
  });

  it("refuses the overwrite policy and the root", async () => {
    const { writer } = createWriter([DOCS, ARCHIVE, REPORT]);

    expect(
      codeOf(await writer.move(moveRequest({ onConflict: "overwrite" }))),
    ).toBe("invalid_request");
    expect(codeOf(await writer.move(moveRequest({ ref: "root" })))).toBe(
      "unsupported_operation",
    );
  });

  it("fails for a missing entry and a target that is missing or no folder", async () => {
    const { writer } = createWriter([DOCS, ARCHIVE, REPORT]);

    expect(codeOf(await writer.move(moveRequest({ ref: "gone" })))).toBe(
      "not_found",
    );
    expect(
      codeOf(await writer.move(moveRequest({ targetParentRef: "gone" }))),
    ).toBe("not_found");
    expect(
      codeOf(await writer.move(moveRequest({ targetParentRef: "report" }))),
    ).toBe("not_folder");
  });

  it("refuses to move a folder below itself", async () => {
    const sub = makeEntry("sub", { isFolder: true, parentRef: "docs" });
    const { drive, writer } = createWriter([DOCS, sub]);
    const result = await writer.move(
      moveRequest({ ref: "docs", targetParentRef: "sub" }),
    );

    expect(codeOf(result)).toBe("invalid_request");
    expect(drive.calls.change).not.toHaveBeenCalled();
  });

  it("fails on a taken name and renames the moved entry for keep_both", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, REPORT, TAKEN]);

    expect(codeOf(await writer.move(moveRequest()))).toBe("name_conflict");

    const moved = valueOf(
      await writer.move(moveRequest({ onConflict: "keep_both" })),
    );

    expect(moved.name).toBe("report (2).pdf");
    expect(drive.calls.change).toHaveBeenCalledWith(TOKEN, "report", {
      addParentId: "archive",
      name: "report (2).pdf",
      removeParentId: "docs",
    });
  });

  it("translates a refused change", async () => {
    const { drive, writer } = createWriter([DOCS, ARCHIVE, REPORT]);

    drive.calls.change.mockResolvedValueOnce(refusal("provider_forbidden"));

    expect(codeOf(await writer.move(moveRequest()))).toBe("provider_forbidden");
  });
});

describe("StorageFileWriter rename", () => {
  it("renames the entry within its folder", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);
    const renamed = valueOf(await writer.rename(renameRequest(" final.pdf ")));

    expect(renamed.name).toBe("final.pdf");
    expect(drive.calls.change).toHaveBeenCalledWith(TOKEN, "report", {
      name: "final.pdf",
    });
  });

  it("refuses an unusable name, the overwrite policy and the root", async () => {
    const { writer } = createWriter([DOCS, REPORT]);

    expect(codeOf(await writer.rename(renameRequest("a/b")))).toBe(
      "invalid_request",
    );
    expect(codeOf(await writer.rename(renameRequest("x", "overwrite")))).toBe(
      "invalid_request",
    );
    expect(
      codeOf(await writer.rename({ ...renameRequest("x"), ref: "root" })),
    ).toBe("unsupported_operation");
  });

  it("fails for a missing entry or a vanished parent folder", async () => {
    const orphan = makeEntry("orphan", { parentRef: "lost" });
    const { writer } = createWriter([DOCS, orphan]);

    expect(
      codeOf(await writer.rename({ ...renameRequest("x"), ref: "gone" })),
    ).toBe("not_found");
    expect(
      codeOf(await writer.rename({ ...renameRequest("x"), ref: "orphan" })),
    ).toBe("not_found");
  });

  it("fails on a name taken by another entry but not by itself", async () => {
    const other = makeEntry("other", { name: "other.pdf", parentRef: "docs" });
    const { writer } = createWriter([DOCS, REPORT, other]);

    expect(codeOf(await writer.rename(renameRequest("other.pdf")))).toBe(
      "name_conflict",
    );
    expect(valueOf(await writer.rename(renameRequest("report.pdf"))).name).toBe(
      "report.pdf",
    );
  });

  it("numbers the name for keep_both", async () => {
    const other = makeEntry("other", { name: "other.pdf", parentRef: "docs" });
    const { writer } = createWriter([DOCS, REPORT, other]);

    expect(
      valueOf(await writer.rename(renameRequest("other.pdf", "keep_both")))
        .name,
    ).toBe("other (2).pdf");
  });

  it("translates a refused change", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);

    drive.calls.change.mockResolvedValueOnce(refusal("provider_forbidden"));

    expect(codeOf(await writer.rename(renameRequest("x")))).toBe(
      "provider_forbidden",
    );
  });
});
