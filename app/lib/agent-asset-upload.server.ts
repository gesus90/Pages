import type { UploadedFile } from "@/backend/service/WikiService";

async function* chunks(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Describes a raw binary stream; file metadata comes from the consumed ticket. */
export function readAgentAssetUpload(
  request: Request,
  fileName: string,
): UploadedFile {
  const length = Number(request.headers.get("content-length"));
  return {
    fileName,
    body: chunks(request.body),
    contentLength: Number.isSafeInteger(length) && length > 0 ? length : null,
  };
}
