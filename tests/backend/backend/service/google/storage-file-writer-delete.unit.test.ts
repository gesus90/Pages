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
import type { StorageConfirmation } from "@/definition/GoogleDriveFiles";

const DOCS = makeEntry("docs", { isFolder: true, name: "Docs" });
const REPORT = makeEntry("report", {
  name: "report.pdf",
  parentRef: "docs",
  sizeBytes: 40,
});
const SUB = makeEntry("sub", {
  isFolder: true,
  name: "Sub",
  parentRef: "docs",
});
const INNER = makeEntry("inner", {
  name: "inner.txt",
  parentRef: "sub",
  sizeBytes: 2,
});

function trashRequest(
  ref: string,
  confirmation: string | null = null,
): Parameters<StorageFileWriter["trash"]>[0] {
  return { confirmation, ref, userId: USER };
}

async function confirmationOf(
  result: ReturnType<StorageFileWriter["trash"]>,
): Promise<StorageConfirmation> {
  const outcome = await result;

  if (outcome.ok || !outcome.error.confirmation) {
    throw new Error("expected a confirmation request");
  }

  return outcome.error.confirmation;
}

describe("StorageFileWriter trash", () => {
  it("moves a file to the trash without a confirmation", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);
    const trashed = valueOf(await writer.trash(trashRequest("report")));

    expect(trashed.isTrashed).toBe(true);
    expect(drive.calls.change).toHaveBeenCalledWith(TOKEN, "report", {
      isTrashed: true,
    });
  });

  it("refuses the root, a trashed entry and an invalid reference", async () => {
    const { writer } = createWriter([
      DOCS,
      makeEntry("old", { isTrashed: true, parentRef: "docs" }),
    ]);

    expect(codeOf(await writer.trash(trashRequest("root")))).toBe(
      "unsupported_operation",
    );
    expect(codeOf(await writer.trash(trashRequest("old")))).toBe("trashed");
    expect(codeOf(await writer.trash(trashRequest("a b")))).toBe(
      "invalid_reference",
    );
  });

  it("shows the counted scope of a folder and trashes it only after the confirmation", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT, SUB, INNER]);
    const confirmation = await confirmationOf(
      writer.trash(trashRequest("docs")),
    );

    expect(confirmation.scope).toEqual({
      fileCount: 2,
      folderCount: 1,
      isTruncated: false,
      totalBytes: 42,
    });
    expect(drive.calls.change).not.toHaveBeenCalled();

    const trashed = valueOf(
      await writer.trash(trashRequest("docs", confirmation.token)),
    );

    expect(trashed.isTrashed).toBe(true);
  });

  it("refuses a confirmation when the folder content changed in between", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);
    const confirmation = await confirmationOf(
      writer.trash(trashRequest("docs")),
    );

    drive.children.set("docs", [REPORT, SUB]);

    const retry = await writer.trash(trashRequest("docs", confirmation.token));

    expect(codeOf(retry)).toBe("confirmation_invalid");
    expect(drive.calls.change).not.toHaveBeenCalled();
  });

  it("refuses a confirmation of another account", async () => {
    const { writer } = createWriter([DOCS, REPORT]);
    const confirmation = await confirmationOf(
      writer.trash(trashRequest("docs")),
    );
    const other = await writer.trash({
      ...trashRequest("docs", confirmation.token),
      userId: "user-2",
    });

    expect(codeOf(other)).toBe("confirmation_invalid");
  });

  it("translates a refused trashing and a failed scope count", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);

    drive.calls.change.mockResolvedValueOnce(refusal("provider_forbidden"));
    expect(codeOf(await writer.trash(trashRequest("report")))).toBe(
      "provider_forbidden",
    );

    drive.calls.query.mockResolvedValueOnce(refusal("provider_unreachable"));
    expect(codeOf(await writer.trash(trashRequest("docs")))).toBe(
      "provider_unreachable",
    );
  });
});

describe("StorageFileWriter restore", () => {
  const TRASHED = makeEntry("old", {
    isExplicitlyTrashed: true,
    isTrashed: true,
    parentRef: "docs",
  });

  it("takes an explicitly trashed entry out of the trash", async () => {
    const { drive, writer } = createWriter([DOCS, TRASHED]);
    const restored = valueOf(
      await writer.restore({ ref: "old", userId: USER }),
    );

    expect(restored.isTrashed).toBe(false);
    expect(drive.calls.change).toHaveBeenCalledWith(TOKEN, "old", {
      isTrashed: false,
    });
  });

  it("refuses an invalid reference, a live entry and one trashed only with its folder", async () => {
    const { drive, writer } = createWriter([
      DOCS,
      REPORT,
      makeEntry("below", { isTrashed: true, parentRef: "docs" }),
    ]);

    expect(codeOf(await writer.restore({ ref: "a b", userId: USER }))).toBe(
      "invalid_reference",
    );
    expect(codeOf(await writer.restore({ ref: "report", userId: USER }))).toBe(
      "not_trashed",
    );
    expect(codeOf(await writer.restore({ ref: "below", userId: USER }))).toBe(
      "unsupported_operation",
    );
    expect(codeOf(await writer.restore({ ref: "gone", userId: USER }))).toBe(
      "not_found",
    );
    expect(drive.calls.change).not.toHaveBeenCalled();
  });

  it("translates a refused restore", async () => {
    const { drive, writer } = createWriter([DOCS, TRASHED]);

    drive.calls.change.mockResolvedValueOnce(refusal("provider_forbidden"));

    expect(codeOf(await writer.restore({ ref: "old", userId: USER }))).toBe(
      "provider_forbidden",
    );
  });
});

describe("StorageFileWriter deletePermanently", () => {
  it("removes a trashed file after the confirmation and names what went", async () => {
    const trashed = makeEntry("old", {
      isExplicitlyTrashed: true,
      isTrashed: true,
      name: "old.txt",
      parentRef: "docs",
    });
    const { drive, writer } = createWriter([DOCS, trashed]);
    const first = await writer.deletePermanently(trashRequest("old"));

    expect(codeOf(first)).toBe("confirmation_required");

    const token = first.ok ? "" : (first.error.confirmation?.token ?? "");
    const deleted = valueOf(
      await writer.deletePermanently(trashRequest("old", token)),
    );

    expect(deleted).toEqual({ name: "old.txt", ref: "old", scope: null });
    expect(drive.calls.remove).toHaveBeenCalledWith(TOKEN, "old");
  });

  it("reports the scope of a deleted folder", async () => {
    const { writer } = createWriter([DOCS, REPORT, SUB, INNER]);
    const first = await writer.deletePermanently(trashRequest("docs"));
    const token = first.ok ? "" : (first.error.confirmation?.token ?? "");
    const deleted = valueOf(
      await writer.deletePermanently(trashRequest("docs", token)),
    );

    expect(deleted.scope).toEqual({
      fileCount: 2,
      folderCount: 1,
      isTruncated: false,
      totalBytes: 42,
    });
  });

  it("refuses the root, invalid references and entries without a parent", async () => {
    const lonely = makeEntry("lonely", { parentRef: null });
    const { drive, writer } = createWriter([DOCS, lonely]);

    expect(codeOf(await writer.deletePermanently(trashRequest("root")))).toBe(
      "invalid_reference",
    );
    expect(codeOf(await writer.deletePermanently(trashRequest("a b")))).toBe(
      "invalid_reference",
    );
    expect(codeOf(await writer.deletePermanently(trashRequest("lonely")))).toBe(
      "unsupported_operation",
    );
    expect(codeOf(await writer.deletePermanently(trashRequest("gone")))).toBe(
      "not_found",
    );
    expect(drive.calls.remove).not.toHaveBeenCalled();
  });

  it("translates a refused removal", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);
    const first = await writer.deletePermanently(trashRequest("report"));
    const token = first.ok ? "" : (first.error.confirmation?.token ?? "");

    drive.calls.remove.mockResolvedValueOnce(refusal("provider_forbidden"));

    expect(
      codeOf(await writer.deletePermanently(trashRequest("report", token))),
    ).toBe("provider_forbidden");
  });
});

describe("StorageFileWriter confirm", () => {
  it("issues a confirmation with the target and no scope for a file", async () => {
    const { writer } = createWriter([DOCS, REPORT]);
    const confirmation = valueOf(
      await writer.confirm({ action: "update", ref: "report", userId: USER }),
    );

    expect(confirmation).toMatchObject({
      action: "update",
      scope: null,
      target: REPORT,
    });
    expect(confirmation.token.length).toBeGreaterThan(20);
  });

  it("counts a folder across several pages and stops at the scope limit", async () => {
    const { drive, writer } = createWriter([DOCS]);
    const page = (
      count: number,
      start: number,
    ): ReturnType<typeof makeEntry>[] =>
      Array.from({ length: count }, (slot, index) =>
        makeEntry(`f${start + index}`, { parentRef: "docs", sizeBytes: 1 }),
      );

    drive.calls.query
      .mockResolvedValueOnce({
        ok: true,
        value: { entries: page(1000, 0), nextPageToken: "next" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { entries: page(1000, 1000), nextPageToken: "more" },
      });

    const confirmation = valueOf(
      await writer.confirm({ action: "delete", ref: "docs", userId: USER }),
    );

    expect(confirmation.scope).toEqual({
      fileCount: 2000,
      folderCount: 0,
      isTruncated: true,
      totalBytes: 2000,
    });
  });

  it("follows page tokens until the last page", async () => {
    const { drive, writer } = createWriter([DOCS]);

    drive.calls.query
      .mockResolvedValueOnce({
        ok: true,
        value: { entries: [REPORT], nextPageToken: "next" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { entries: [SUB], nextPageToken: null },
      });

    const confirmation = valueOf(
      await writer.confirm({ action: "delete", ref: "docs", userId: USER }),
    );

    expect(confirmation.scope).toMatchObject({ fileCount: 1, folderCount: 1 });
    expect(drive.calls.query.mock.calls[1]?.[1]).toMatchObject({
      pageToken: "next",
    });
  });

  it("refuses invalid references and passes Drive refusals through", async () => {
    const { writer } = createWriter([DOCS]);

    expect(
      codeOf(
        await writer.confirm({ action: "delete", ref: "a b", userId: USER }),
      ),
    ).toBe("invalid_reference");
    expect(
      codeOf(
        await writer.confirm({ action: "delete", ref: "gone", userId: USER }),
      ),
    ).toBe("not_found");
  });
});
