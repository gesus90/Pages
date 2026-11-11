import { vi } from "vitest";

import { StorageFileReader } from "@/backend/service/google/StorageFileReader";

import { createConnection, makeEntry } from "./storage-file-writer-harness";

import type {
  DriveItemResult,
  DriveMedia,
} from "@/backend/google/GoogleDriveItemsClient";
import type {
  StorageConnection,
  StorageDriveClient,
} from "@/backend/service/google/StorageFileSupport";
import type {
  StorageEntry,
  StorageEntryPage,
} from "@/definition/GoogleDriveFiles";

export {
  codeOf,
  createConnection,
  makeEntry,
  refusal,
  TOKEN,
  valueOf,
} from "./storage-file-writer-harness";

export const GOOGLE_DOCUMENT = "application/vnd.google-apps.document";
export const GOOGLE_DRAWING = "application/vnd.google-apps.drawing";
export const GOOGLE_FORM = "application/vnd.google-apps.form";
export const PDF = "application/pdf";

/** The scripted Drive calls the reader makes. */
export interface ReaderDrive {
  readonly stat: ReturnType<typeof vi.fn<StorageDriveClient["stat"]>>;
  readonly query: ReturnType<typeof vi.fn<StorageDriveClient["query"]>>;
  readonly listSharedDrives: ReturnType<
    typeof vi.fn<StorageDriveClient["listSharedDrives"]>
  >;
  readonly readQuota: ReturnType<typeof vi.fn<StorageDriveClient["readQuota"]>>;
  readonly download: ReturnType<typeof vi.fn<StorageDriveClient["download"]>>;
  readonly export: ReturnType<typeof vi.fn<StorageDriveClient["export"]>>;
}

/**
 * Wraps a value in a successful Drive result.
 *
 * @param value - The value.
 * @returns The result.
 */
export function ok<Value>(value: Value): DriveItemResult<Value> {
  return { ok: true, value };
}

/**
 * Builds a page of entries.
 *
 * @param entries - The entries.
 * @param nextPageToken - The token of the next page.
 * @returns The page.
 */
export function pageOf(
  entries: readonly StorageEntry[],
  nextPageToken: string | null = null,
): StorageEntryPage {
  return { entries, nextPageToken };
}

type CancelRecorder = ReturnType<typeof vi.fn<() => void>>;

function streamOf(
  chunks: readonly string[],
  isClosing: boolean,
  cancel: CancelRecorder,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    cancel,
    start(controller): void {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      if (isClosing) {
        controller.close();
      }
    },
  });
}

/**
 * Builds a media stream that yields the chunks and ends.
 *
 * @param chunks - The text chunks to deliver.
 * @param sizeBytes - The size Drive announced.
 * @returns The media and the cancellation recorder.
 */
export function mediaOf(
  chunks: readonly string[],
  sizeBytes: number | null = null,
): { readonly media: DriveMedia; readonly cancel: CancelRecorder } {
  const cancel = vi.fn<() => void>();
  const body = streamOf(chunks, true, cancel);

  return { cancel, media: { body, mimeType: "text/plain", sizeBytes } };
}

/**
 * Builds a media stream that yields the chunks and stays open, so that a
 * reader that stops early has to cancel it.
 *
 * @param chunks - The text chunks to deliver.
 * @returns The media and the cancellation recorder.
 */
export function openMediaOf(chunks: readonly string[]): {
  readonly media: DriveMedia;
  readonly cancel: CancelRecorder;
} {
  const cancel = vi.fn<() => void>();
  const body = streamOf(chunks, false, cancel);

  return { cancel, media: { body, mimeType: "text/plain", sizeBytes: null } };
}

/**
 * Builds a reader over a scripted Drive; unscripted calls refuse with `not_found`.
 *
 * @param connection - The connection; a full-access one by default.
 * @returns The reader and the Drive recorders.
 */
export function createReader(
  connection: StorageConnection = createConnection(),
): {
  readonly reader: StorageFileReader;
  readonly drive: ReaderDrive;
} {
  const missing = async (): Promise<DriveItemResult<never>> => ({
    code: "not_found",
    connectionProblem: null,
    ok: false,
  });
  const drive: ReaderDrive = {
    download: vi.fn<StorageDriveClient["download"]>(missing),
    export: vi.fn<StorageDriveClient["export"]>(missing),
    listSharedDrives: vi.fn<StorageDriveClient["listSharedDrives"]>(missing),
    query: vi.fn<StorageDriveClient["query"]>(missing),
    readQuota: vi.fn<StorageDriveClient["readQuota"]>(missing),
    stat: vi.fn<StorageDriveClient["stat"]>(missing),
  };
  const client: StorageDriveClient = {
    ...drive,
    change: vi.fn(),
    copy: vi.fn(),
    createFolder: vi.fn(),
    remove: vi.fn(),
    replaceContent: vi.fn(),
    upload: vi.fn(),
  };

  return { drive, reader: new StorageFileReader(connection, client) };
}

/**
 * Scripts `stat` from a table of entries; other references are not found.
 *
 * @param drive - The Drive recorders.
 * @param entries - The known entries.
 */
export function scriptEntries(
  drive: ReaderDrive,
  entries: readonly StorageEntry[],
): void {
  drive.stat.mockImplementation(async (accessToken, ref) => {
    const entry = entries.find((candidate) => candidate.ref === ref);

    return entry
      ? ok(entry)
      : { code: "not_found", connectionProblem: null, ok: false };
  });
}

/** A My Drive root folder. */
export const ROOT = makeEntry("root", {
  isFolder: true,
  name: "My Drive",
  parentRef: null,
});
