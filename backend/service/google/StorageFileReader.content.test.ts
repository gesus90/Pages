import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { StorageFileReader } from "./StorageFileReader";

import type {
  DriveItemFailure,
  DriveMedia,
} from "@/backend/google/GoogleDriveItemsClient";
import type { StorageEntry } from "@/definition/GoogleDriveFiles";
import type { StorageDriveClient } from "./StorageFileSupport";

const DOCUMENT = "application/vnd.google-apps.document";
const FORM = "application/vnd.google-apps.form";
const LIMIT = 1024 * 1024;

function entryOf(overrides: Partial<StorageEntry> = {}): StorageEntry {
  return {
    ref: "e1",
    name: "Name",
    isFolder: false,
    mimeType: "text/plain",
    isGoogleDocument: false,
    isTrashed: false,
    isExplicitlyTrashed: false,
    modifiedAt: null,
    sizeBytes: null,
    parentRef: null,
    driveRef: null,
    version: null,
    webViewLink: null,
    exportFormats: [],
    ...overrides,
  };
}

const FAILURE: DriveItemFailure = {
  ok: false,
  code: "not_found",
  connectionProblem: null,
};

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function mediaOf(
  text: string,
  sizeBytes: number | null = null,
  mimeType = "text/plain",
): { ok: true; value: DriveMedia } {
  return {
    ok: true as const,
    value: {
      body: streamOf([new TextEncoder().encode(text)]),
      mimeType,
      sizeBytes,
    },
  };
}

type DriveMethod =
  "stat" | "download" | "export" | "query" | "listSharedDrives";

interface Setup {
  readonly drive: Record<DriveMethod, Mock>;
  readonly reader: StorageFileReader;
}

function setup(isConnected = true): Setup {
  const drive = {
    stat: vi.fn(),
    download: vi.fn(),
    export: vi.fn(),
    query: vi.fn(),
    listSharedDrives: vi.fn(),
  };
  const connection = {
    access: vi.fn(async () =>
      isConnected
        ? {
            ok: true as const,
            accessToken: "tok",
            permissionId: "p",
            accountEmail: null,
            grantedScopes: [],
          }
        : { ok: false as const, state: "unavailable" as const, problem: null },
    ),
  };
  const reader = new StorageFileReader(
    connection,
    drive as unknown as StorageDriveClient,
  );

  return { drive, reader };
}

function statReturns(drive: Setup["drive"], entry: StorageEntry): void {
  drive.stat.mockResolvedValue({ ok: true, value: entry });
}

describe("StorageFileReader.read", () => {
  it("fails early for connection, entry and folder", async () => {
    expect(await setup(false).reader.read("a", null)).toMatchObject({
      error: { code: "connection_unavailable" },
    });

    const { drive, reader } = setup();
    drive.stat.mockResolvedValueOnce(FAILURE);

    expect(await reader.read("a", null)).toMatchObject({ ok: false });

    statReturns(drive, entryOf({ isFolder: true }));

    expect(await reader.read("a", null)).toMatchObject({
      error: { code: "is_folder" },
    });
  });

  it("reads a text file", async () => {
    const { drive, reader } = setup();
    const entry = entryOf({ sizeBytes: 5 });
    statReturns(drive, entry);
    drive.download.mockResolvedValue(mediaOf("hello", 5));

    expect(await reader.read("a", null)).toEqual({
      ok: true,
      value: { entry, mimeType: "text/plain", text: "hello" },
    });
  });

  it.each(["application/json; charset=utf-8", "image/svg+xml"])(
    "treats %s as text",
    async (mimeType) => {
      const { drive, reader } = setup();
      statReturns(drive, entryOf({ mimeType }));
      drive.download.mockResolvedValue(mediaOf("{}"));

      expect(await reader.read("a", null)).toMatchObject({ ok: true });
    },
  );

  it("refuses binary types with the text export formats", async () => {
    const { drive, reader } = setup();
    statReturns(
      drive,
      entryOf({
        mimeType: "application/pdf",
        exportFormats: ["text/csv", "application/pdf"],
      }),
    );

    expect(await reader.read("a", null)).toEqual({
      ok: false,
      error: { code: "unsupported_operation", exportFormats: ["text/csv"] },
    });
  });

  it("refuses a file above the limit by size and by stream", async () => {
    const { drive, reader } = setup();
    statReturns(drive, entryOf({ sizeBytes: LIMIT + 1 }));

    expect(await reader.read("a", null)).toMatchObject({
      error: { code: "too_large", limitBytes: LIMIT },
    });

    statReturns(drive, entryOf());
    drive.download.mockResolvedValueOnce(mediaOf("x", LIMIT + 1));

    expect(await reader.read("a", null)).toMatchObject({
      error: { code: "too_large" },
    });

    drive.download.mockResolvedValueOnce({
      ok: true,
      value: { body: null, mimeType: "text/plain", sizeBytes: LIMIT + 1 },
    });

    expect(await reader.read("a", null)).toMatchObject({
      error: { code: "too_large" },
    });

    drive.download.mockResolvedValueOnce({
      ok: true,
      value: {
        body: streamOf([new Uint8Array(LIMIT), new Uint8Array(1)]),
        mimeType: "text/plain",
        sizeBytes: null,
      },
    });

    expect(await reader.read("a", null)).toMatchObject({
      error: { code: "too_large" },
    });
  });
});

describe("StorageFileReader.read bodies", () => {
  it("reads an empty body as empty text", async () => {
    const { drive, reader } = setup();
    statReturns(drive, entryOf());
    drive.download.mockResolvedValue({
      ok: true,
      value: { body: null, mimeType: "text/plain", sizeBytes: null },
    });

    expect(await reader.read("a", null)).toMatchObject({
      ok: true,
      value: { text: "" },
    });
  });

  it("returns a failure of the download", async () => {
    const { drive, reader } = setup();
    statReturns(drive, entryOf());
    drive.download.mockResolvedValue(FAILURE);

    expect(await reader.read("a", null)).toMatchObject({ ok: false });
  });

  it("exports a Google document in the default or a named format", async () => {
    const { drive, reader } = setup();
    statReturns(drive, entryOf({ mimeType: DOCUMENT, name: "Doc" }));
    drive.export.mockImplementation(async () => mediaOf("body"));

    expect(await reader.read("a", null)).toMatchObject({
      ok: true,
      value: { mimeType: "text/plain" },
    });
    expect(drive.export).toHaveBeenLastCalledWith("tok", "e1", "text/plain");

    await reader.read("a", "text/html");

    expect(drive.export).toHaveBeenLastCalledWith("tok", "e1", "text/html");
  });
});

describe("StorageFileReader.read formats", () => {
  it("refuses Google documents without a usable text format", async () => {
    const { drive, reader } = setup();
    statReturns(drive, entryOf({ mimeType: DOCUMENT }));

    expect(await reader.read("a", "application/zip")).toMatchObject({
      error: { code: "unsupported_operation" },
    });

    statReturns(drive, entryOf({ mimeType: FORM }));

    expect(await reader.read("a", null)).toMatchObject({
      error: { code: "unsupported_operation" },
    });
    expect(await reader.read("a", "text/plain")).toMatchObject({
      error: { code: "unsupported_operation" },
    });
  });
});

describe("StorageFileReader.download", () => {
  it("fails early for connection, entry and folder", async () => {
    expect(await setup(false).reader.download("a", null)).toMatchObject({
      ok: false,
    });

    const { drive, reader } = setup();
    drive.stat.mockResolvedValueOnce(FAILURE);

    expect(await reader.download("a", null)).toMatchObject({ ok: false });

    statReturns(drive, entryOf({ isFolder: true }));

    expect(await reader.download("a", null)).toMatchObject({
      error: { code: "is_folder" },
    });
  });

  it("downloads a plain file under its own name", async () => {
    const { drive, reader } = setup();
    const entry = entryOf({ name: "a.bin", mimeType: "application/zip" });
    statReturns(drive, entry);
    const media = mediaOf("zz");
    drive.download.mockResolvedValue(media);

    expect(await reader.download("a", null)).toEqual({
      ok: true,
      value: { entry, fileName: "a.bin", media: media.value },
    });
  });

  it("returns a failed download", async () => {
    const { drive, reader } = setup();
    statReturns(drive, entryOf());
    drive.download.mockResolvedValue(FAILURE);

    expect(await reader.download("a", null)).toMatchObject({ ok: false });
  });

  it("exports Google documents with the extension of the format", async () => {
    const { drive, reader } = setup();
    statReturns(
      drive,
      entryOf({
        name: "Doc",
        mimeType: DOCUMENT,
        exportFormats: ["application/pdf", "application/x-odd"],
      }),
    );
    drive.export.mockResolvedValue(mediaOf("x"));

    expect(await reader.download("a", "application/pdf")).toMatchObject({
      value: { fileName: "Doc.pdf" },
    });
    expect(await reader.download("a", "application/x-odd")).toMatchObject({
      value: { fileName: "Doc" },
    });
  });

  it("refuses a missing or unsupported export format", async () => {
    const { drive, reader } = setup();
    statReturns(
      drive,
      entryOf({ mimeType: DOCUMENT, exportFormats: ["application/pdf"] }),
    );

    expect(await reader.download("a", null)).toEqual({
      ok: false,
      error: {
        code: "unsupported_operation",
        exportFormats: ["application/pdf"],
      },
    });
    expect(await reader.download("a", "text/csv")).toMatchObject({
      error: { code: "unsupported_operation" },
    });
  });
});
