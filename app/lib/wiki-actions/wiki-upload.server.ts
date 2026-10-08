import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import type { UploadedFile } from "@/backend/service/WikiService";

/**
 * Reads a request body as chunks.
 *
 * @param body - The body of an upload request.
 * @yields The chunks, as they arrive.
 */
export async function* readBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Describes an upload request for the wiki service.
 *
 * @param request - A `PUT` request whose body is the file.
 * @param fileName - Name of the file, from the address.
 * @returns The file as the service takes it; a request without a body counts
 * as an empty file.
 */
export function toUploadedFile(
  request: Request,
  fileName: string,
): UploadedFile {
  const length = Number(request.headers.get("content-length"));

  return {
    body: request.body
      ? readBody(request.body)
      : readBody(new Blob([]).stream()),
    contentLength: Number.isFinite(length) && length > 0 ? length : null,
    fileName,
  };
}

/**
 * Maps the failure of an upload to a status code.
 *
 * @param error - The failure.
 * @returns The status and the code the client translates, or `null` for
 * failures that are not the person's doing.
 */
export function describeUploadFailure(
  error: unknown,
): { readonly status: number; readonly error: string } | null {
  if (error instanceof WikiValidationError) {
    return {
      error: error.code,
      status: error.code === "fileTooLarge" ? 413 : 400,
    };
  }

  if (error instanceof WikiPageNotFoundError) {
    return { error: "notFound", status: 404 };
  }

  return error instanceof WikiAccessDeniedError
    ? { error: "forbidden", status: 403 }
    : null;
}
