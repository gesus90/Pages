import { describe, expect, it } from "vitest";

import { STORAGE_MAX_READ_BYTES } from "@/backend/service/google/StorageFileReader";

import {
  GOOGLE_DOCUMENT,
  GOOGLE_DRAWING,
  GOOGLE_FORM,
  PDF,
  codeOf,
  createConnection,
  createReader,
  makeEntry,
  mediaOf,
  ok,
  openMediaOf,
  refusal,
  scriptEntries,
  valueOf,
} from "./storage-file-reader-harness";

const DOCUMENT_FORMATS = ["text/plain", "text/markdown", PDF];

function googleDocument(
  overrides: Parameters<typeof makeEntry>[1] = {},
): ReturnType<typeof makeEntry> {
  return makeEntry("gdoc", {
    exportFormats: DOCUMENT_FORMATS,
    isGoogleDocument: true,
    mimeType: GOOGLE_DOCUMENT,
    name: "Konzept",
    sizeBytes: null,
    ...overrides,
  });
}

describe("StorageFileReader.read of a stored file", () => {
  it("returns the text of a text file", async () => {
    const { drive, reader } = createReader();
    const file = makeEntry("file1", { mimeType: "text/plain", sizeBytes: 11 });

    scriptEntries(drive, [file]);
    drive.download.mockResolvedValue(
      ok(mediaOf(["héllo ", "wörld"], 11).media),
    );

    const content = valueOf(await reader.read("file1", null));

    expect(content).toEqual({
      entry: file,
      mimeType: "text/plain",
      text: "héllo wörld",
    });
    expect(drive.download).toHaveBeenCalledWith("access-token", "file1");
    expect(drive.export).not.toHaveBeenCalled();
  });

  it.each([
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "image/svg+xml",
    "text/csv; charset=utf-8",
  ])("treats %s as text", async (mimeType) => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [makeEntry("file1", { mimeType })]);
    drive.download.mockResolvedValue(ok(mediaOf(["{}"]).media));

    expect(valueOf(await reader.read("file1", null)).text).toBe("{}");
  });

  it("refuses a binary file and lists only text exports", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("image", {
        exportFormats: ["text/plain", PDF],
        mimeType: "image/png",
      }),
    ]);

    expect(await reader.read("image", null)).toEqual({
      error: {
        code: "unsupported_operation",
        exportFormats: ["text/plain"],
      },
      ok: false,
    });
    expect(drive.download).not.toHaveBeenCalled();
  });

  it("refuses a file larger than the inline limit before downloading", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("big", { sizeBytes: STORAGE_MAX_READ_BYTES + 1 }),
    ]);

    expect(await reader.read("big", null)).toEqual({
      error: { code: "too_large", limitBytes: STORAGE_MAX_READ_BYTES },
      ok: false,
    });
    expect(drive.download).not.toHaveBeenCalled();
  });

  it("reads a file of exactly the inline limit", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("edge", { sizeBytes: STORAGE_MAX_READ_BYTES }),
    ]);
    drive.download.mockResolvedValue(
      ok(mediaOf(["a".repeat(STORAGE_MAX_READ_BYTES)]).media),
    );

    expect(valueOf(await reader.read("edge", null)).text).toHaveLength(
      STORAGE_MAX_READ_BYTES,
    );
  });

  it("cancels a stream that grows beyond the limit", async () => {
    const { drive, reader } = createReader();
    const stream = openMediaOf(["a".repeat(STORAGE_MAX_READ_BYTES), "b"]);

    scriptEntries(drive, [makeEntry("grown", { sizeBytes: null })]);
    drive.download.mockResolvedValue(ok(stream.media));

    expect(codeOf(await reader.read("grown", null))).toBe("too_large");
    expect(stream.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a stream whose announced size exceeds the limit", async () => {
    const { drive, reader } = createReader();
    const stream = mediaOf(["small"], STORAGE_MAX_READ_BYTES + 1);

    scriptEntries(drive, [makeEntry("liar", { sizeBytes: 5 })]);
    drive.download.mockResolvedValue(ok(stream.media));

    expect(codeOf(await reader.read("liar", null))).toBe("too_large");
    expect(stream.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("StorageFileReader.read of media without a usable size", () => {
  it("refuses an announced oversize even without a body", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [makeEntry("bodyless", { sizeBytes: 5 })]);
    drive.download.mockResolvedValue(
      ok({
        body: null,
        mimeType: "text/plain",
        sizeBytes: STORAGE_MAX_READ_BYTES + 1,
      }),
    );

    expect(codeOf(await reader.read("bodyless", null))).toBe("too_large");
  });

  it("reads an empty text when the media has no body", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [makeEntry("empty", { sizeBytes: 0 })]);
    drive.download.mockResolvedValue(
      ok({ body: null, mimeType: "text/plain", sizeBytes: 0 }),
    );

    expect(valueOf(await reader.read("empty", null)).text).toBe("");
  });
});

describe("StorageFileReader.read refusals", () => {
  it("refuses a folder, a trashed file, an invalid and an unknown reference", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("folder", { isFolder: true }),
      makeEntry("gone", { isTrashed: true }),
    ]);

    expect(codeOf(await reader.read("folder", null))).toBe("is_folder");
    expect(codeOf(await reader.read("gone", null))).toBe("trashed");
    expect(codeOf(await reader.read("a b", null))).toBe("invalid_reference");
    expect(codeOf(await reader.read("nope", null))).toBe("not_found");
  });

  it("translates a refused download", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [makeEntry("file1")]);
    drive.download.mockResolvedValue(refusal("provider_forbidden"));

    expect(codeOf(await reader.read("file1", null))).toBe("provider_forbidden");
  });

  it("reports an unusable connection", async () => {
    const { drive, reader } = createReader(
      createConnection({ ok: false, problem: null, state: "not_configured" }),
    );

    expect(codeOf(await reader.read("file1", null))).toBe(
      "connection_unavailable",
    );
    expect(drive.stat).not.toHaveBeenCalled();
  });
});

describe("StorageFileReader.read of a Google document", () => {
  it("exports the default text format and keeps the entry", async () => {
    const { drive, reader } = createReader();
    const document = googleDocument();

    scriptEntries(drive, [document]);
    drive.export.mockResolvedValue(ok(mediaOf(["Inhalt"]).media));

    const content = valueOf(await reader.read("gdoc", null));

    expect(content).toEqual({
      entry: document,
      mimeType: "text/plain",
      text: "Inhalt",
    });
    expect(drive.export).toHaveBeenCalledWith(
      "access-token",
      "gdoc",
      "text/plain",
    );
    expect(drive.download).not.toHaveBeenCalled();
  });

  it("exports the named supported text format", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [googleDocument()]);
    drive.export.mockResolvedValue(ok(mediaOf(["# Titel"]).media));

    const content = valueOf(await reader.read("gdoc", "text/markdown"));

    expect(content.mimeType).toBe("text/markdown");
    expect(drive.export.mock.calls[0]?.[2]).toBe("text/markdown");
  });

  it("refuses a binary export and an unsupported format with the text exports", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [googleDocument()]);

    const expected = {
      error: {
        code: "unsupported_operation",
        exportFormats: ["text/plain", "text/markdown"],
      },
      ok: false,
    };

    expect(await reader.read("gdoc", PDF)).toEqual(expected);
    expect(await reader.read("gdoc", "text/csv")).toEqual(expected);
    expect(drive.export).not.toHaveBeenCalled();
  });

  it("refuses a Google type without any supported export", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      makeEntry("form", { mimeType: GOOGLE_FORM, sizeBytes: null }),
    ]);

    expect(await reader.read("form", null)).toEqual({
      error: { code: "unsupported_operation", exportFormats: [] },
      ok: false,
    });
  });

  it("reads a drawing as SVG by default", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [
      googleDocument({
        exportFormats: ["image/svg+xml", "image/png"],
        mimeType: GOOGLE_DRAWING,
      }),
    ]);
    drive.export.mockResolvedValue(ok(mediaOf(["<svg/>"]).media));

    const content = valueOf(await reader.read("gdoc", null));

    expect(content.mimeType).toBe("image/svg+xml");
    expect(content.text).toBe("<svg/>");
  });

  it("translates a refused export", async () => {
    const { drive, reader } = createReader();

    scriptEntries(drive, [googleDocument()]);
    drive.export.mockResolvedValue(refusal("too_large"));

    expect(codeOf(await reader.read("gdoc", null))).toBe("too_large");
  });
});
