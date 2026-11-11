import { describe, expect, it } from "vitest";

import {
  GOOGLE_DOCUMENT,
  GOOGLE_FORM,
  PDF,
  codeOf,
  createConnection,
  createReader,
  makeEntry,
  mediaOf,
  ok,
  refusal,
  scriptEntries,
  valueOf,
} from "./storage-file-reader-harness";

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function googleDocument(
  mimeType: string,
  exportFormats: readonly string[],
): ReturnType<typeof makeEntry> {
  return makeEntry("gdoc", {
    exportFormats,
    isGoogleDocument: true,
    mimeType,
    name: "Konzept",
    sizeBytes: null,
  });
}

describe("StorageFileReader.download", () => {
  it("streams the bytes of a stored file under its own name", async () => {
    const { drive, reader } = createReader();
    const file = makeEntry("file1", { mimeType: PDF, name: "Scan.pdf" });
    const stream = mediaOf(["%PDF"], 4);

    scriptEntries(drive, [file]);
    drive.download.mockResolvedValue(ok(stream.media));

    const download = valueOf(await reader.download("file1", "ignored"));

    expect(download.entry).toBe(file);
    expect(download.fileName).toBe("Scan.pdf");
    expect(download.media).toBe(stream.media);
    expect(drive.download).toHaveBeenCalledWith("access-token", "file1");
    expect(drive.export).not.toHaveBeenCalled();
  });

  it.each([
    [PDF, "Konzept.pdf"],
    [DOCX, "Konzept.docx"],
    ["text/markdown", "Konzept.md"],
    ["text/html", "Konzept.html"],
  ])("exports a Google document as %s into %s", async (format, fileName) => {
    const { drive, reader } = createReader();
    const stream = mediaOf(["bytes"]);

    scriptEntries(drive, [
      googleDocument(GOOGLE_DOCUMENT, [
        PDF,
        DOCX,
        "text/markdown",
        "text/html",
      ]),
    ]);
    drive.export.mockResolvedValue(ok(stream.media));

    const download = valueOf(await reader.download("gdoc", format));

    expect(download.fileName).toBe(fileName);
    expect(download.media).toBe(stream.media);
    expect(drive.export).toHaveBeenCalledWith("access-token", "gdoc", format);
    expect(drive.download).not.toHaveBeenCalled();
  });

  it("keeps the plain name when an export format has no known extension", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      googleDocument(GOOGLE_DOCUMENT, ["application/x-odd"]),
    ]);
    drive.export.mockResolvedValue(ok(mediaOf([]).media));

    expect(
      valueOf(await reader.download("gdoc", "application/x-odd")).fileName,
    ).toBe("Konzept");
  });

  it("needs an export format for a Google document", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [googleDocument(GOOGLE_DOCUMENT, [PDF])]);

    expect(await reader.download("gdoc", null)).toEqual({
      error: { code: "unsupported_operation", exportFormats: [PDF] },
      ok: false,
    });
    expect(drive.export).not.toHaveBeenCalled();
  });

  it("refuses an export format the document does not offer", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [googleDocument(GOOGLE_FORM, [])]);

    expect(await reader.download("gdoc", PDF)).toEqual({
      error: { code: "unsupported_operation", exportFormats: [] },
      ok: false,
    });
    expect(drive.export).not.toHaveBeenCalled();
  });

  it("refuses a folder, a trashed file and an invalid reference", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("folder", { isFolder: true }),
      makeEntry("gone", { isTrashed: true }),
    ]);

    expect(codeOf(await reader.download("folder", null))).toBe("is_folder");
    expect(codeOf(await reader.download("gone", null))).toBe("trashed");
    expect(codeOf(await reader.download("a b", null))).toBe(
      "invalid_reference",
    );
  });

  it("translates a refused download and an unusable connection", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [makeEntry("file1")]);
    drive.download.mockResolvedValue(refusal("provider_unreachable"));

    expect(codeOf(await reader.download("file1", null))).toBe(
      "provider_unreachable",
    );

    const closed = createReader(
      createConnection({
        ok: false,
        problem: "secret_unavailable",
        state: "reauthorization_required",
      }),
    );

    expect(codeOf(await closed.reader.download("file1", null))).toBe(
      "connection_unavailable",
    );
  });
});

describe("StorageFileReader.quota", () => {
  it("returns the quota reading of Drive", async () => {
    const { drive, reader } = createReader();
    const reading = {
      limitBytes: 1000,
      usageBytes: 400,
      usageInDriveBytes: 300,
      usageInTrashBytes: 100,
    };

    drive.readQuota.mockResolvedValue(ok(reading));

    expect(valueOf(await reader.quota())).toEqual(reading);
    expect(drive.readQuota).toHaveBeenCalledWith("access-token");
  });

  it("translates a refused reading and an unusable connection", async () => {
    const { drive, reader } = createReader();

    drive.readQuota.mockResolvedValue(refusal("provider_scope_missing"));

    expect(await reader.quota()).toEqual({
      error: {
        code: "provider_scope_missing",
        consentPath: "/settings/system?googleDriveAccess=write",
      },
      ok: false,
    });

    const closed = createReader(
      createConnection({ ok: false, problem: null, state: "disconnected" }),
    );

    expect(codeOf(await closed.reader.quota())).toBe("connection_unavailable");
    expect(closed.drive.readQuota).not.toHaveBeenCalled();
  });
});
