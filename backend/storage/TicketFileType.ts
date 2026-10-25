import { detectFileType } from "@/backend/service/wiki/WikiFileTypes";

import type { DetectedFileType } from "@/backend/service/wiki/WikiFileTypes";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/wav": "wav",
  "video/x-msvideo": "avi",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
  "image/svg+xml": "svg",
  "text/html": "html",
};

/** A ticket file's extension and media type, determined only from its bytes. */
export interface TicketFileType extends DetectedFileType {
  readonly extension: string;
}

/** Active documents get recognizable suffixes but remain download-only files. */
export function detectTicketFileType(head: Buffer): TicketFileType {
  const detected = detectFileType(head);
  const text = head
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  let contentType = detected.contentType;
  if (text.startsWith("%PDF-")) contentType = "application/pdf";
  else if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text))
    contentType = "image/svg+xml";
  else if (/^(?:<!doctype\s+html[\s>]|<html[\s>])/i.test(text))
    contentType = "text/html";
  return {
    ...detected,
    contentType,
    extension: EXTENSIONS[contentType] ?? "bin",
  };
}
