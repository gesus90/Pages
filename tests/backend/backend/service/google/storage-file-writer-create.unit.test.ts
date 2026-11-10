import { describe, expect, it } from "vitest";

import { STORAGE_MAX_UPLOAD_BYTES } from "@/backend/service/google/StorageFileWriter";

import {
  READ_SCOPE,
  TOKEN,
  USER,
  codeOf,
  createConnection,
  createWriter,
  makeEntry,
  refusal,
  valueOf,
} from "./storage-file-writer-harness";

import type { StorageFileWriter } from "@/backend/service/google/StorageFileWriter";
import type { StorageConflictPolicy } from "@/definition/GoogleDriveFiles";

const DOCS = makeEntry("docs", { isFolder: true, name: "Docs" });
const REPORT = makeEntry("report", {
  name: "report.pdf",
  parentRef: "docs",
});

function folderRequest(
  name: string,
  onConflict: StorageConflictPolicy = "fail",
  parentRef = "docs",
): Parameters<StorageFileWriter["createFolder"]>[0] {
  return { name, onConflict, parentRef, userId: USER };
}

function uploadRequest(
  overrides: Partial<Parameters<StorageFileWriter["upload"]>[0]> = {},
): Parameters<StorageFileWriter["upload"]>[0] {
  return {
    bytes: new Uint8Array(3),
    confirmation: null,
    mimeType: "application/pdf",
    name: "new.pdf",
    onConflict: "fail",
    parentRef: "docs",
    userId: USER,
    ...overrides,
  };
}

describe("StorageFileWriter createFolder", () => {
  it("creates a folder with the trimmed name below the parent", async () => {
    const { drive, writer } = createWriter([DOCS]);
    const folder = valueOf(await writer.createFolder(folderRequest("  Neu  ")));

    expect(folder.name).toBe("Neu");
    expect(drive.calls.createFolder).toHaveBeenCalledWith(TOKEN, {
      name: "Neu",
      parentId: "docs",
    });
  });

  it("refuses unusable names and the overwrite policy before any Drive call", async () => {
    const { drive, writer } = createWriter([DOCS]);

    expect(codeOf(await writer.createFolder(folderRequest("a/b")))).toBe(
      "invalid_request",
    );
    expect(codeOf(await writer.createFolder(folderRequest("  ")))).toBe(
      "invalid_request",
    );
    expect(
      codeOf(await writer.createFolder(folderRequest("Neu", "overwrite"))),
    ).toBe("invalid_request");
    expect(drive.calls.stat).not.toHaveBeenCalled();
  });
});

describe("StorageFileWriter createFolder refusals", () => {
  it("reports an unusable connection with its state", async () => {
    const { writer } = createWriter(
      [DOCS],
      createConnection({
        ok: false,
        problem: "access_revoked",
        state: "reauthorization_required",
      }),
    );
    const result = await writer.createFolder(folderRequest("Neu"));

    expect(result).toEqual({
      error: {
        code: "connection_unavailable",
        connectionProblem: "access_revoked",
        connectionState: "reauthorization_required",
      },
      ok: false,
    });
  });

  it("points to the consent path when only read access was granted", async () => {
    const { drive, writer } = createWriter(
      [DOCS],
      createConnection({
        accessToken: TOKEN,
        accountEmail: null,
        grantedScopes: [READ_SCOPE],
        ok: true,
        permissionId: "permission",
      }),
    );
    const result = await writer.createFolder(folderRequest("Neu"));

    expect(result).toEqual({
      error: {
        code: "provider_scope_missing",
        consentPath: "/settings/system?googleDriveAccess=write",
      },
      ok: false,
    });
    expect(drive.calls.createFolder).not.toHaveBeenCalled();
  });

  it("fails for a missing, trashed or non-folder parent", async () => {
    const { writer } = createWriter([
      DOCS,
      REPORT,
      makeEntry("bin", { isFolder: true, isTrashed: true, parentRef: "root" }),
    ]);

    expect(
      codeOf(await writer.createFolder(folderRequest("Neu", "fail", "gone"))),
    ).toBe("not_found");
    expect(
      codeOf(await writer.createFolder(folderRequest("Neu", "fail", "bin"))),
    ).toBe("trashed");
    expect(
      codeOf(await writer.createFolder(folderRequest("Neu", "fail", "report"))),
    ).toBe("not_folder");
    expect(
      codeOf(await writer.createFolder(folderRequest("Neu", "fail", "a b"))),
    ).toBe("invalid_reference");
  });
});

describe("StorageFileWriter createFolder naming", () => {
  it("fails with the conflicting entries when the name is taken", async () => {
    const { drive, writer } = createWriter([DOCS, REPORT]);
    const result = await writer.createFolder(folderRequest("report.pdf"));

    expect(result).toEqual({
      error: { code: "name_conflict", conflicts: [REPORT] },
      ok: false,
    });
    expect(drive.calls.createFolder).not.toHaveBeenCalled();
  });

  it("keeps both by numbering the new name", async () => {
    const { drive, writer } = createWriter([
      DOCS,
      REPORT,
      makeEntry("report2", { name: "report (2).pdf", parentRef: "docs" }),
    ]);

    valueOf(
      await writer.createFolder(folderRequest("report.pdf", "keep_both")),
    );

    expect(drive.calls.createFolder).toHaveBeenCalledWith(TOKEN, {
      name: "report (3).pdf",
      parentId: "docs",
    });
  });

  it("translates a refusal of the conflict search and of the creation", async () => {
    const { drive, writer } = createWriter([DOCS]);

    drive.calls.query.mockResolvedValueOnce(
      refusal("connection_unavailable", "secret_unavailable"),
    );
    expect(await writer.createFolder(folderRequest("Neu"))).toEqual({
      error: {
        code: "connection_unavailable",
        connectionProblem: "secret_unavailable",
        connectionState: "reauthorization_required",
      },
      ok: false,
    });

    drive.calls.createFolder.mockResolvedValueOnce(
      refusal("provider_scope_missing"),
    );
    expect(await writer.createFolder(folderRequest("Neu"))).toEqual({
      error: {
        code: "provider_scope_missing",
        consentPath: "/settings/system?googleDriveAccess=write",
      },
      ok: false,
    });

    drive.calls.createFolder.mockResolvedValueOnce(
      refusal("connection_unavailable", "drive_api_disabled"),
    );
    expect(codeOf(await writer.createFolder(folderRequest("Neu")))).toBe(
      "connection_unavailable",
    );
  });
});

describe("StorageFileWriter upload", () => {
  it("uploads the bytes under the checked name", async () => {
    const { drive, writer } = createWriter([DOCS]);
    const bytes = new Uint8Array([1, 2, 3]);
    const file = valueOf(
      await writer.upload(uploadRequest({ bytes, name: " new.pdf " })),
    );

    expect(file.name).toBe("new.pdf");
    expect(drive.calls.upload).toHaveBeenCalledWith(TOKEN, {
      content: bytes,
      mimeType: "application/pdf",
      name: "new.pdf",
      parentId: "docs",
    });
  });

  it("refuses an invalid name and an oversized upload", async () => {
    const { drive, writer } = createWriter([DOCS]);

    expect(codeOf(await writer.upload(uploadRequest({ name: ".." })))).toBe(
      "invalid_request",
    );

    const tooLarge = await writer.upload(
      uploadRequest({ bytes: new Uint8Array(STORAGE_MAX_UPLOAD_BYTES + 1) }),
    );

    expect(tooLarge).toEqual({
      error: { code: "too_large", limitBytes: STORAGE_MAX_UPLOAD_BYTES },
      ok: false,
    });
    expect(drive.calls.upload).not.toHaveBeenCalled();
  });

  it("passes the failures of session and parent through", async () => {
    const refused = createWriter(
      [DOCS],
      createConnection({
        ok: false,
        problem: null,
        state: "unavailable",
      }),
    );

    expect(await refused.writer.upload(uploadRequest())).toEqual({
      error: {
        code: "connection_unavailable",
        connectionProblem: null,
        connectionState: "unavailable",
      },
      ok: false,
    });

    const { writer } = createWriter([DOCS]);

    expect(
      codeOf(await writer.upload(uploadRequest({ parentRef: "gone" }))),
    ).toBe("not_found");
  });

  it("fails on a taken name and keeps both on request", async () => {
    const { drive, writer } = createWriter([
      DOCS,
      makeEntry("old", { name: "new.pdf", parentRef: "docs" }),
    ]);

    expect(codeOf(await writer.upload(uploadRequest()))).toBe("name_conflict");

    valueOf(await writer.upload(uploadRequest({ onConflict: "keep_both" })));

    expect(drive.calls.upload).toHaveBeenCalledTimes(1);
    expect(drive.calls.upload.mock.calls[0]?.[1]).toMatchObject({
      name: "new (2).pdf",
    });
  });

  it("translates a refused upload", async () => {
    const { drive, writer } = createWriter([DOCS]);

    drive.calls.upload.mockResolvedValueOnce(refusal("provider_forbidden"));

    expect(codeOf(await writer.upload(uploadRequest()))).toBe(
      "provider_forbidden",
    );
  });

  it("uploads as new when overwrite finds no file of that name", async () => {
    const { drive, writer } = createWriter([DOCS]);

    valueOf(await writer.upload(uploadRequest({ onConflict: "overwrite" })));

    expect(drive.calls.upload).toHaveBeenCalledTimes(1);
    expect(drive.calls.replaceContent).not.toHaveBeenCalled();
  });
});
