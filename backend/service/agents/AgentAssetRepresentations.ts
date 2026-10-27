import { detectTicketFileType } from "@/backend/storage/TicketFileType";
import { readPdfDocument } from "@/backend/service/chat/ChatPdfText";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

/** Derives model content without executing sources, following links or altering the original. */
export async function assetRepresentation(bytes: Buffer): Promise<{
  readonly mimeType: string;
  readonly content: AgentTicketAssetContent["content"];
}> {
  const mimeType = detectTicketFileType(bytes).contentType;
  if (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp"
  ) {
    if (!hasCompleteImage(bytes, mimeType)) throw new Error("Incomplete image");
    return {
      mimeType,
      content: { type: "image", mimeType, base64: bytes.toString("base64") },
    };
  }
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-")
    return pdfRepresentation(bytes);
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
      throw new Error("Binary file");
    return {
      mimeType:
        mimeType === "application/octet-stream" ? "text/plain" : mimeType,
      content: { type: "text", text, representation: "source" },
    };
  } catch {
    return {
      mimeType,
      content: { type: "file", reason: "unsupported-model-content" },
    };
  }
}

function hasCompleteImage(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return completeJpeg(bytes);
  if (mimeType === "image/webp") return completeWebp(bytes);
  if (
    bytes.length < 45 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(8) !== 13
  )
    return false;
  if (!bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) return false;
  let offset = 8;
  let hasPixels = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    offset += length + 12;
    if (offset > bytes.length) return false;
    if (type === "IDAT") hasPixels = true;
    if (type === "IEND")
      return hasPixels && length === 0 && offset === bytes.length;
  }
  return false;
}

function completeJpeg(bytes: Buffer): boolean {
  if (
    bytes.length < 12 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    return false;
  let offset = 2;
  let hasFrame = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return hasFrame;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) return false;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    )
      hasFrame =
        length >= 8 &&
        bytes.readUInt16BE(offset + 5) > 0 &&
        bytes.readUInt16BE(offset + 7) > 0;
    offset += length + 2;
  }
  return false;
}

function completeWebp(bytes: Buffer): boolean {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length)
    return false;
  let offset = 12;
  let hasPixels = false;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (["VP8 ", "VP8L", "ANMF"].includes(kind) && size > 0) hasPixels = true;
    offset += 8 + size + (size % 2);
    if (offset > bytes.length) return false;
  }
  return hasPixels && offset === bytes.length;
}

async function pdfRepresentation(
  bytes: Buffer,
): ReturnType<typeof assetRepresentation> {
  const reading = await readPdfDocument(bytes);
  if (reading.status !== "read")
    return {
      mimeType: "application/pdf",
      content: { type: "file", reason: `pdf-${reading.status}` },
    };
  const text = reading.document.sections
    .map((section) => section.text)
    .join("\n\n");
  const maximumCharacters = 400_000;
  return {
    mimeType: "application/pdf",
    content: {
      type: "text",
      representation: "text-extract",
      text: text.slice(0, maximumCharacters),
      isTruncated:
        reading.document.isTruncated || text.length > maximumCharacters,
    },
  };
}
