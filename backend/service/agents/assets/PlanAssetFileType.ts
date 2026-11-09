import { detectTicketFileType } from "@/backend/storage/TicketFileType";
import { GENERIC_CONTENT_TYPE } from "@/backend/service/wiki/WikiFileTypes";

import type { AgentPlanAssetKind } from "@/definition/AgentPlanAsset";

/** What the server found out about a plan asset from its first bytes. */
export interface PlanAssetFileType {
  readonly mediaType: string;
  readonly kind: AgentPlanAssetKind;
}

/** ZIP based office formats, told apart by their name once the content is a ZIP. */
const OFFICE_TYPES: Readonly<Record<string, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
};

/** Plain text formats, told apart by their name once the content is UTF-8 text. */
const TEXT_TYPES: Readonly<Record<string, string>> = {
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

function extensionOf(fileName: string): string {
  return /\.([a-z0-9]{1,8})$/iu.exec(fileName)?.[1]?.toLowerCase() ?? "";
}

function kindOf(mediaType: string): AgentPlanAssetKind {
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType === "application/zip") return "archive";
  if (
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/plain") ||
    mediaType.startsWith("application/vnd.") ||
    Object.values(TEXT_TYPES).includes(mediaType) ||
    mediaType === "application/epub+zip"
  )
    return "document";
  return "other";
}

/** Matroska and WebM share their container; only the document type tells them apart. */
function containerType(head: Buffer, detected: string): string {
  if (detected === "video/webm" && head.includes("matroska", 0, "latin1"))
    return "video/x-matroska";
  if (detected === "video/mp4") {
    const brand = head.toString("latin1", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
  }
  return detected;
}

function isUtf8Text(head: Buffer): boolean {
  if (head.length === 0) return false;
  try {
    // The head may end inside a character; only its complete part is checked.
    const complete =
      head.length <= 4 ? head : head.subarray(0, head.length - 4);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(complete);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text);
  } catch {
    return false;
  }
}

function zipType(head: Buffer, extension: string): string | null {
  if (head.readUInt32LE(0) !== 0x04034b50) return null;
  return OFFICE_TYPES[extension] ?? "application/zip";
}

/**
 * Recognizes a plan asset by its content.
 *
 * @param head - The first bytes of the file.
 * @param fileName - The name as uploaded; it only tells apart formats that
 * share a container (DOCX and ZIP, Markdown and plain text) after the content
 * was recognized. It never makes an unknown file a known one.
 * @returns The media type and family; anything unknown is `other` with a
 * generic type and is only ever served as a download.
 */
export function detectPlanAssetType(
  head: Buffer,
  fileName: string,
): PlanAssetFileType {
  const extension = extensionOf(fileName);
  const detected = detectTicketFileType(head).contentType;
  if (detected === "text/html") return { mediaType: detected, kind: "other" };
  if (detected !== GENERIC_CONTENT_TYPE) {
    const mediaType = containerType(head, detected);
    return { mediaType, kind: kindOf(mediaType) };
  }
  const zip = head.length >= 4 ? zipType(head, extension) : null;
  if (zip) return { mediaType: zip, kind: kindOf(zip) };
  if (isUtf8Text(head)) {
    const mediaType = TEXT_TYPES[extension] ?? "text/plain";
    return { mediaType, kind: "document" };
  }
  return { mediaType: GENERIC_CONTENT_TYPE, kind: "other" };
}
