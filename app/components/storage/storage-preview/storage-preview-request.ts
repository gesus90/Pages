import { z } from "zod";

import { storageDownloadHref } from "../storage-actions-requests";

/** The Storage interface; the preview reads through `stat` and `download`. */
const STORAGE_API_V1 = "/storage-api/v1";

const entrySchema = z.object({
  exportFormats: z.array(z.string()),
  isFolder: z.boolean(),
  isTrashed: z.boolean(),
  mimeType: z.string(),
  modifiedAt: z.string().nullable(),
  name: z.string(),
  ref: z.string(),
  sizeBytes: z.number().nullable(),
  webViewLink: z.string().nullable(),
});

const statSchema = z.object({
  ok: z.literal(true),
  result: z.object({ entry: entrySchema }),
});

const errorSchema = z.object({
  error: z.object({ code: z.string(), limitBytes: z.number().optional() }),
});

/** A file as the preview reads it from Drive right now. */
export type StoragePreviewEntry = z.infer<typeof entrySchema>;

/** Why a file could not be read. */
export type StoragePreviewFailureReason = "forbidden" | "notFound" | "failed";

/** Why a request has no value: a failure, no preview for the file, or its size. */
export type StoragePreviewRefusalReason =
  StoragePreviewFailureReason | "unsupported" | "tooLarge";

/** The refusal of a read request. */
export interface StoragePreviewRefusal {
  readonly ok: false;
  readonly reason: StoragePreviewRefusalReason;
  /** The limit the request applied or the server named; `null` when none. */
  readonly limitBytes: number | null;
}

/** The answer of one read request: the value, or why there is none. */
export type StoragePreviewReply<Value> =
  { readonly ok: true; readonly value: Value } | StoragePreviewRefusal;

/** Error codes of the Storage interface by what the person has to know. */
const REASONS_BY_CODE: ReadonlyMap<string, StoragePreviewRefusalReason> =
  new Map([
    ["forbidden", "forbidden"],
    ["invalid_reference", "notFound"],
    ["is_folder", "notFound"],
    ["not_found", "notFound"],
    ["provider_forbidden", "forbidden"],
    ["provider_scope_missing", "forbidden"],
    ["too_large", "tooLarge"],
    ["trashed", "notFound"],
    ["unsupported_operation", "unsupported"],
  ]);

function failure(
  reason: StoragePreviewRefusalReason,
  limitBytes: number | null = null,
): StoragePreviewRefusal {
  return { limitBytes, ok: false, reason };
}

/** Reads the refusal of the server; its status decides when it names no code. */
async function readRefusal(response: Response): Promise<StoragePreviewRefusal> {
  try {
    const parsed = errorSchema.safeParse(await response.json());

    if (parsed.success) {
      const { code, limitBytes } = parsed.data.error;

      return failure(REASONS_BY_CODE.get(code) ?? "failed", limitBytes ?? null);
    }
  } catch {
    // An answer that is no JSON, such as a page of a proxy, is told by its status.
  }

  if (response.status === 403) return failure("forbidden");
  if (response.status === 404 || response.status === 410) {
    return failure("notFound");
  }

  return failure("failed");
}

/**
 * Reads a body up to a limit and stops reading beyond it.
 * @param response - The answer whose body is read.
 * @param limitBytes - The most bytes accepted.
 * @returns The bytes, or `null` as soon as the body holds more than the limit.
 * @remarks
 * The size a file announces can be missing or wrong, so only the bytes that
 * really arrive count; the rest of the body is cancelled unread.
 */
export async function readBoundedBytes(
  response: Response,
  limitBytes: number,
): Promise<Uint8Array | null> {
  const announced = Number(response.headers.get("content-length"));

  if (Number.isFinite(announced) && announced > limitBytes) {
    await response.body?.cancel();

    return null;
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    return bytes.length > limitBytes ? null : bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let chunk = await reader.read();

  while (!chunk.done) {
    length += chunk.value.length;

    if (length > limitBytes) {
      await reader.cancel();

      return null;
    }

    chunks.push(chunk.value);
    chunk = await reader.read();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
}

/**
 * Reads the current metadata of a file.
 * @param ref - The reference of the file.
 * @param signal - Ends the request when the preview moves on.
 * @returns The entry, or why it cannot be read.
 */
export async function requestStoragePreviewEntry(
  ref: string,
  signal: AbortSignal,
): Promise<StoragePreviewReply<StoragePreviewEntry>> {
  const response = await fetch(
    `${STORAGE_API_V1}/stat?${new URLSearchParams({ ref }).toString()}`,
    { cache: "no-store", headers: { Accept: "application/json" }, signal },
  );

  if (!response.ok) return readRefusal(response);

  const parsed = statSchema.safeParse(await response.json());

  return parsed.success
    ? { ok: true, value: parsed.data.result.entry }
    : failure("failed");
}

/**
 * Reads the bytes of a file, or of one export of a Google document, through
 * the authenticated download of Storage.
 * @param input - The reference, the export format and the byte limit.
 * @param signal - Ends the request when the preview moves on.
 * @returns The bytes, or why they cannot be read.
 */
export async function requestStoragePreviewBytes(
  input: {
    readonly ref: string;
    readonly exportFormat: string | null;
    readonly limitBytes: number;
  },
  signal: AbortSignal,
): Promise<StoragePreviewReply<Uint8Array>> {
  const response = await fetch(
    storageDownloadHref(input.ref, input.exportFormat),
    { cache: "no-store", signal },
  );

  if (!response.ok) return readRefusal(response);

  const bytes = await readBoundedBytes(response, input.limitBytes);

  return bytes === null
    ? failure("tooLarge", input.limitBytes)
    : { ok: true, value: bytes };
}
