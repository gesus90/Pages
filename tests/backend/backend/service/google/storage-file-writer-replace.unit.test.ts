import { describe, expect, it } from "vitest";

import { STORAGE_MAX_UPLOAD_BYTES } from "@/backend/service/google/StorageFileWriter";

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
import type {
  StorageEntry,
  StorageErrorCode,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

const DOCS = makeEntry("docs", { isFolder: true, name: "Docs" });
const NOTES = makeEntry("notes", { name: "notes.txt", parentRef: "docs" });
const NEW_BYTES = new Uint8Array([9, 9]);

function updateRequest(
  confirmation: string | null,
  ref = "notes",
): Parameters<StorageFileWriter["update"]>[0] {
  return {
    bytes: NEW_BYTES,
    confirmation,
    mimeType: "text/plain",
    ref,
    userId: USER,
  };
}

function overwriteRequest(
  confirmation: string | null,
): Parameters<StorageFileWriter["upload"]>[0] {
  return {
    bytes: NEW_BYTES,
    confirmation,
    mimeType: "text/plain",
    name: "notes.txt",
    onConflict: "overwrite",
    parentRef: "docs",
    userId: USER,
  };
}

async function confirmationFor(
  writer: StorageFileWriter,
  action: "update" | "overwrite",
): Promise<string> {
  const result = await writer.confirm({ action, ref: "notes", userId: USER });

  return valueOf(result).token;
}

function errorOf(result: StorageResult<StorageEntry>): {
  code?: StorageErrorCode;
  confirmationToken?: string;
} {
  if (result.ok) return {};

  return {
    code: result.error.code,
    ...(result.error.confirmation
      ? { confirmationToken: result.error.confirmation.token }
      : {}),
  };
}

describe("StorageFileWriter update", () => {
  it("asks for a confirmation bound to the file before replacing bytes", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);
    const first = await writer.update(updateRequest(null));

    expect(errorOf(first).code).toBe("confirmation_required");
    expect(first.ok ? null : first.error.confirmation).toMatchObject({
      action: "update",
      scope: null,
      target: NOTES,
    });
    expect(drive.calls.replaceContent).not.toHaveBeenCalled();
  });

  it("replaces the bytes with the confirmation and spends it", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);
    const token = await confirmationFor(writer, "update");
    const updated = valueOf(await writer.update(updateRequest(token)));

    expect(updated.version).toBe("2");
    expect(drive.calls.replaceContent).toHaveBeenCalledWith(TOKEN, "notes", {
      bytes: NEW_BYTES,
      mimeType: "text/plain",
    });
    expect(errorOf(await writer.update(updateRequest(token))).code).toBe(
      "confirmation_invalid",
    );
  });

  it("refuses a confirmation of another action and issues a fresh one", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);
    const token = await confirmationFor(writer, "overwrite");
    const refused = errorOf(await writer.update(updateRequest(token)));

    expect(refused.code).toBe("confirmation_invalid");
    expect(refused.confirmationToken).toBeTypeOf("string");
    expect(refused.confirmationToken).not.toBe(token);
    expect(drive.calls.replaceContent).not.toHaveBeenCalled();
  });

  it("refuses a confirmation after the file changed", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);
    const token = await confirmationFor(writer, "update");

    drive.entries.set("notes", { ...NOTES, version: "7" });

    expect(errorOf(await writer.update(updateRequest(token))).code).toBe(
      "confirmation_invalid",
    );
  });

  it("refuses a folder, a Google document and an oversized body", async () => {
    const { writer } = createWriter([
      DOCS,
      makeEntry("sheet", {
        isGoogleDocument: true,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parentRef: "docs",
      }),
    ]);

    expect(codeOf(await writer.update(updateRequest(null, "docs")))).toBe(
      "is_folder",
    );
    expect(codeOf(await writer.update(updateRequest(null, "sheet")))).toBe(
      "unsupported_operation",
    );
    expect(
      codeOf(
        await writer.update({
          ...updateRequest(null),
          bytes: new Uint8Array(STORAGE_MAX_UPLOAD_BYTES + 1),
        }),
      ),
    ).toBe("too_large");
  });

  it("fails when the entry is missing or in the trash", async () => {
    const { writer } = createWriter([
      DOCS,
      makeEntry("old", { isTrashed: true, parentRef: "docs" }),
    ]);

    expect(codeOf(await writer.update(updateRequest(null, "gone")))).toBe(
      "not_found",
    );
    expect(codeOf(await writer.update(updateRequest(null, "old")))).toBe(
      "trashed",
    );
  });

  it("translates a refused replacement", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);
    const token = await confirmationFor(writer, "update");

    drive.calls.replaceContent.mockResolvedValueOnce(
      refusal("provider_forbidden"),
    );

    expect(codeOf(await writer.update(updateRequest(token)))).toBe(
      "provider_forbidden",
    );
  });

  it("stops when the folder scope of the gate cannot be counted", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);

    drive.calls.query.mockResolvedValueOnce(refusal("provider_unreachable"));

    expect(
      codeOf(
        await writer.confirm({ action: "delete", ref: "docs", userId: USER }),
      ),
    ).toBe("provider_unreachable");
  });
});

describe("StorageFileWriter upload with overwrite", () => {
  it("asks for a confirmation, then replaces the one file of that name", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);
    const first = await writer.upload(overwriteRequest(null));

    expect(errorOf(first).code).toBe("confirmation_required");

    const token = await confirmationFor(writer, "overwrite");
    const replaced = valueOf(await writer.upload(overwriteRequest(token)));

    expect(replaced.ref).toBe("notes");
    expect(drive.calls.replaceContent).toHaveBeenCalledTimes(1);
    expect(drive.calls.upload).not.toHaveBeenCalled();
  });

  it("refuses to choose between several files of the same name", async () => {
    const { drive, writer } = createWriter([
      DOCS,
      NOTES,
      makeEntry("notes-b", { name: "notes.txt", parentRef: "docs" }),
    ]);
    const result = await writer.upload(overwriteRequest(null));

    expect(errorOf(result).code).toBe("name_conflict");
    expect(result.ok ? [] : result.error.conflicts).toHaveLength(2);
    expect(drive.calls.replaceContent).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a folder or a Google document", async () => {
    const folder = createWriter([
      DOCS,
      makeEntry("same", {
        isFolder: true,
        name: "notes.txt",
        parentRef: "docs",
      }),
    ]);

    expect(codeOf(await folder.writer.upload(overwriteRequest(null)))).toBe(
      "is_folder",
    );

    const document = createWriter([
      DOCS,
      makeEntry("doc", {
        isGoogleDocument: true,
        mimeType: "application/vnd.google-apps.document",
        name: "notes.txt",
        parentRef: "docs",
      }),
    ]);

    expect(codeOf(await document.writer.upload(overwriteRequest(null)))).toBe(
      "unsupported_operation",
    );
  });

  it("passes a failed conflict search through", async () => {
    const { drive, writer } = createWriter([DOCS, NOTES]);

    drive.calls.query.mockResolvedValueOnce(refusal("provider_unreachable"));

    expect(codeOf(await writer.upload(overwriteRequest(null)))).toBe(
      "provider_unreachable",
    );
  });
});
