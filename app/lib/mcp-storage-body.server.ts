import { STORAGE_JSON_BODY_LIMIT } from "@/app/lib/storage-api.server";
import { STORAGE_MAX_UPLOAD_BYTES } from "@/backend/service/google/StorageFileWriter";

import type { StorageResult } from "@/definition/GoogleDriveFiles";

const FORM_OVERHEAD_BYTES = 64 * 1024;

/** Bounded content and untrusted metadata of a Storage MCP write. */
export interface McpStorageBody {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly bytes: Uint8Array<ArrayBuffer> | null;
}

async function readBytes(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length")) > limit) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
    return new Uint8Array(Buffer.concat(chunks, length));
  } finally {
    reader.releaseLock();
  }
}

function contentBytes(
  metadata: Readonly<Record<string, unknown>>,
): Uint8Array<ArrayBuffer> | null {
  if (typeof metadata.content !== "string") return null;
  if (metadata.encoding === "text")
    return new TextEncoder().encode(metadata.content);
  if (
    metadata.encoding !== "base64" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      metadata.content,
    )
  )
    return null;
  return new Uint8Array(Buffer.from(metadata.content, "base64"));
}

function jsonBody(bytes: Uint8Array<ArrayBuffer>): McpStorageBody | null {
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return null;
  const metadata = Object.fromEntries(Object.entries(body));
  return { metadata, bytes: contentBytes(metadata) };
}

async function formBody(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<McpStorageBody | null> {
  const form = await new Response(bytes, {
    headers: { "Content-Type": contentType },
  }).formData();
  const metadata: Record<string, unknown> = {};
  for (const [name, entry] of form.entries()) {
    if (typeof entry === "string") metadata[name] = entry;
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { metadata, bytes: null };
  return {
    metadata: {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      ...metadata,
    },
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

async function parseBody(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  isTransfer: boolean,
): Promise<McpStorageBody | null> {
  if (contentType.startsWith("application/json")) return jsonBody(bytes);
  if (!isTransfer) return null;
  if (contentType.startsWith("multipart/form-data"))
    return formBody(bytes, contentType);
  return {
    metadata: { mimeType: contentType || "application/octet-stream" },
    bytes,
  };
}

/**
 * Reads bounded JSON, multipart or raw file bytes; never fetches caller-supplied URLs.
 *
 * @param request - The authenticated HTTP call.
 * @param isTransfer - Whether this operation accepts file bytes.
 * @returns Metadata and bytes, or a structured size/parse error.
 */
export async function readMcpStorageBody(
  request: Request,
  isTransfer: boolean,
): Promise<StorageResult<McpStorageBody>> {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.startsWith("application/json");
  const isForm = contentType.startsWith("multipart/form-data");
  const limit =
    !isTransfer || isJson
      ? STORAGE_JSON_BODY_LIMIT
      : STORAGE_MAX_UPLOAD_BYTES + (isForm ? FORM_OVERHEAD_BYTES : 0);
  try {
    const bytes = await readBytes(request, limit);
    if (bytes === null)
      return { ok: false, error: { code: "too_large", limitBytes: limit } };
    const body = await parseBody(bytes, contentType, isTransfer);
    if (
      body !== null &&
      body.bytes !== null &&
      body.bytes.length > STORAGE_MAX_UPLOAD_BYTES
    )
      return {
        ok: false,
        error: { code: "too_large", limitBytes: STORAGE_MAX_UPLOAD_BYTES },
      };
    return body === null
      ? { ok: false, error: { code: "invalid_request" } }
      : { ok: true, value: body };
  } catch {
    // Invalid bodies are input failures; parser errors may contain file contents.
    return { ok: false, error: { code: "invalid_request" } };
  }
}
