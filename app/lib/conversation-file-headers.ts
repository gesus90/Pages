import { contentDisposition } from "@/app/lib/content-disposition";

import type {
  ConversationFileRange,
  OpenedConversationFile,
} from "@/backend/service/conversation/content/ConversationAttachments";

/** A file of a conversation runs no script and loads nothing. */
const FILE_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/** The types a browser shows or plays in place; every other file is a download. */
const INLINE_TYPES =
  /^(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/u;

/** The status and headers a file of a conversation is sent with. */
export interface ConversationFileHead {
  readonly status: 200 | 206;
  readonly headers: Record<string, string>;
}

/**
 * Reads the `Range` header of a request for one byte range.
 *
 * @param header - The header value, or `null` without one.
 * @param size - The size of the whole file.
 * @returns The first and the last byte, or `null` for no or an unusable range.
 */
export function readByteRange(
  header: string | null | undefined,
  size: number,
): ConversationFileRange | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header?.trim() ?? "");
  if (!match || size === 0) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    const length = Math.min(Number(last), size);
    return length > 0 ? { start: size - length, end: size - 1 } : null;
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return start <= end && start < size ? { start, end } : null;
}

/**
 * The headers of a file of a conversation, for the web and for Pica Mobile.
 *
 * @param file - The opened original or preview image.
 * @param isDownload - Sends the file as a download with its name.
 * @returns Status 206 with the range for a part, else 200; byte ranges are
 * announced, any cache stays private, and nothing in the file runs in the
 * origin of Pages.
 */
export function conversationFileHead(
  file: Pick<
    OpenedConversationFile,
    "name" | "mimeType" | "sizeBytes" | "range"
  >,
  isDownload: boolean,
): ConversationFileHead {
  const { range } = file;
  const isInline = !isDownload && INLINE_TYPES.test(file.mimeType);
  const length = range ? range.end - range.start + 1 : file.sizeBytes;
  return {
    status: range ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
      "Content-Disposition": contentDisposition(
        isInline ? "inline" : "attachment",
        file.name,
      ),
      "Content-Length": String(length),
      "Content-Security-Policy": FILE_CONTENT_SECURITY_POLICY,
      "Content-Type": file.mimeType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      ...(range
        ? {
            "Content-Range": `bytes ${String(range.start)}-${String(range.end)}/${String(file.sizeBytes)}`,
          }
        : {}),
    },
  };
}
