import { GOOGLE_DRIVE_NO_STORE_HEADERS } from "@/app/lib/google-drive-route.server";

import type { StorageDownload } from "@/backend/service/google/StorageFileReader";
import type {
  StorageConflictPolicy,
  StorageError,
  StorageErrorCode,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

/** Google's page cursors are short; anything longer is no cursor of Drive. */
const MAXIMUM_PAGE_TOKEN_LENGTH = 2048;

/** A JSON request body of a changing operation is small. */
export const STORAGE_JSON_BODY_LIMIT = 64 * 1024;

/** Room for the form fields around the file of an upload. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** The HTTP status of each error code; `docs/StorageApi.md` lists the same table. */
const ERROR_STATUS: Readonly<Record<StorageErrorCode, number>> = {
  ambiguous_path: 409,
  confirmation_invalid: 409,
  confirmation_required: 428,
  connection_unavailable: 503,
  failed: 500,
  forbidden: 403,
  invalid_path: 400,
  invalid_reference: 400,
  invalid_request: 400,
  is_folder: 409,
  name_conflict: 409,
  not_folder: 409,
  not_found: 404,
  not_trashed: 409,
  provider_forbidden: 403,
  provider_scope_missing: 403,
  provider_unreachable: 502,
  too_large: 413,
  trashed: 410,
  unsupported_operation: 422,
};

/** The untrusted parameters of one call, from the query or the body. */
export interface StorageParameters {
  readonly text: (name: string) => string | null;
  readonly file: (name: string) => File | null;
  /** A list of texts; `null` when the parameter is missing or holds anything else. */
  readonly list: (name: string) => readonly string[] | null;
}

/**
 * Answers a Storage call as JSON that is never stored by a cache.
 *
 * @param result - The result of the service.
 * @param isSimulation - Whether the simulated Drive answered.
 * @returns `{ ok, simulation, result }` or `{ ok, simulation, error }`.
 */
export function storageResponse<Value>(
  result: StorageResult<Value>,
  isSimulation: boolean,
): Response {
  if (!result.ok) {
    return storageErrorResponse(result.error, isSimulation);
  }

  return Response.json(
    { ok: true, result: result.value, simulation: isSimulation },
    { headers: simulationHeaders(isSimulation) },
  );
}

/**
 * Answers a failed Storage call with the status of its code.
 *
 * @param error - The error; it carries no token and no file content.
 * @param isSimulation - Whether the simulated Drive answered.
 * @returns The JSON answer.
 */
export function storageErrorResponse(
  error: StorageError,
  isSimulation: boolean,
): Response {
  return Response.json(
    { error, ok: false, simulation: isSimulation },
    {
      headers: simulationHeaders(isSimulation),
      status: ERROR_STATUS[error.code],
    },
  );
}

function simulationHeaders(isSimulation: boolean): Record<string, string> {
  return {
    ...GOOGLE_DRIVE_NO_STORE_HEADERS,
    "X-Content-Type-Options": "nosniff",
    ...(isSimulation ? { "X-Pages-Storage-Simulation": "1" } : {}),
  };
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/gu, "_");

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Streams a download as an attachment.
 *
 * @param download - The open stream with its type and name.
 * @param isSimulation - Whether the simulated Drive answered.
 * @returns The answer; the content never runs as a page of Pages.
 *
 * @remarks
 * `attachment`, `nosniff` and a sandboxing content security policy keep a
 * downloaded HTML or SVG file from running on the origin of Pages.
 */
export function storageDownloadResponse(
  download: StorageDownload,
  isSimulation: boolean,
): Response {
  const headers: Record<string, string> = {
    ...simulationHeaders(isSimulation),
    "Content-Disposition": contentDisposition(download.fileName),
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Type": download.media.mimeType,
    "X-Pages-Storage-Ref": download.entry.ref,
  };

  if (download.media.sizeBytes !== null) {
    headers["Content-Length"] = String(download.media.sizeBytes);
  }

  return new Response(download.media.body, { headers });
}

/**
 * Reads the conflict policy of a call.
 *
 * @param parameters - The parameters of the call.
 * @returns The policy; `fail` when none or an unknown one is named.
 */
export function readConflictPolicy(
  parameters: StorageParameters,
): StorageConflictPolicy {
  const policy = parameters.text("onConflict");

  return policy === "keep_both" || policy === "overwrite" ? policy : "fail";
}

/**
 * Reads a page cursor.
 *
 * @param parameters - The parameters of the call.
 * @returns The cursor, or `null` when none or an implausible one is named.
 */
export function readPageToken(parameters: StorageParameters): string | null {
  const token = parameters.text("pageToken");

  return token !== null && token.length <= MAXIMUM_PAGE_TOKEN_LENGTH
    ? token
    : null;
}

/**
 * Reads a page size.
 *
 * @param parameters - The parameters of the call.
 * @returns The number, or `null` for the default.
 */
export function readPageSize(parameters: StorageParameters): number | null {
  const size = Number(parameters.text("pageSize") ?? "");

  return Number.isInteger(size) && size > 0 ? size : null;
}

/**
 * Wraps the query of a `GET` call.
 *
 * @param url - The address of the call.
 * @returns Its parameters; files never come in a query.
 */
export function queryParameters(url: URL): StorageParameters {
  return {
    file: () => null,
    list: () => null,
    text: (name) => {
      const entry = url.searchParams.get(name)?.trim() ?? "";

      return entry === "" ? null : entry;
    },
  };
}

async function readLimitedBody(
  request: Request,
  limitBytes: number,
): Promise<Buffer | null> {
  const announced = Number(request.headers.get("content-length"));

  if (Number.isFinite(announced) && announced > limitBytes) {
    return null;
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let chunk = await reader?.read();

  while (reader && chunk && !chunk.done) {
    length += chunk.value.length;

    if (length > limitBytes) {
      await reader.cancel();

      return null;
    }

    chunks.push(chunk.value);
    chunk = await reader.read();
  }

  return Buffer.concat(chunks);
}

/** Keeps a list only when every entry is a text; entries are trimmed. */
function textList(entries: readonly unknown[]): readonly string[] | null {
  const texts = entries.filter(
    (entry): entry is string => typeof entry === "string",
  );

  return texts.length === entries.length
    ? texts.map((text) => text.trim())
    : null;
}

function formParameters(formData: FormData): StorageParameters {
  return {
    file: (name) => {
      const entry = formData.get(name);

      return entry instanceof File ? entry : null;
    },
    list: (name) => {
      const entries = formData.getAll(name);

      return entries.length === 0 ? null : textList(entries);
    },
    text: (name) => {
      const entry = formData.get(name);

      return typeof entry === "string" && entry.trim() !== ""
        ? entry.trim()
        : null;
    },
  };
}

function jsonParameters(body: unknown): StorageParameters | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const record = new Map<string, unknown>(Object.entries(body));

  return {
    file: () => null,
    list: (name) => {
      const entry: unknown = record.get(name);

      return Array.isArray(entry) ? textList(entry) : null;
    },
    text: (name) => {
      const entry = record.get(name);

      return typeof entry === "string" && entry.trim() !== ""
        ? entry.trim()
        : null;
    },
  };
}

/**
 * Reads the body of a changing call: JSON, a form, or a multipart upload.
 *
 * @param request - The request.
 * @param limitBytes - The largest file the call accepts.
 * @returns The parameters, `too_large` past the limit, or `null` for an unreadable body.
 *
 * @remarks
 * The body is read with a hard limit before it is parsed, so an oversized
 * upload is refused without being held in memory.
 */
export async function readBodyParameters(
  request: Request,
  limitBytes: number,
): Promise<StorageParameters | "too_large" | null> {
  const contentType = request.headers.get("content-type") ?? "";
  const isForm =
    contentType.startsWith("multipart/form-data") ||
    contentType.startsWith("application/x-www-form-urlencoded");
  const body = await readLimitedBody(
    request,
    isForm ? limitBytes + FORM_OVERHEAD_BYTES : STORAGE_JSON_BODY_LIMIT,
  );

  if (body === null) {
    return "too_large";
  }

  try {
    if (isForm) {
      const parsed = new Response(new Uint8Array(body), {
        headers: { "Content-Type": contentType },
      });

      return formParameters(await parsed.formData());
    }

    return jsonParameters(JSON.parse(body.toString("utf8")));
  } catch {
    // A body that is neither a form nor JSON is answered as `invalid_request`.
    return null;
  }
}
