import { logCaughtError } from "@/backend/logging/Logger";

import { isChatTextAttachment } from "./ChatAttachmentContent";
import {
  CHAT_DOCUMENT_BYTES,
  isChatDocumentType,
  readChatDocument,
} from "./ChatDocumentReader";

import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type {
  ChatAttachmentPreview,
  ChatPreviewSection,
} from "@/definition/ChatPreview";
import type { ChatAttachmentReader } from "./ChatAttachmentContent";
import type { ChatDocument } from "./ChatDocumentReader";

/** Characters a content preview shows at most. */
const PREVIEW_CHARACTERS = 20_000;

/** Rows and columns of a table preview. */
const PREVIEW_ROWS = 200;
const PREVIEW_COLUMNS = 30;

function cut(text: string, limit: number): { text: string; isCut: boolean } {
  const characters = Array.from(text);
  return {
    text: characters.slice(0, limit).join(""),
    isCut: characters.length > limit,
  };
}

function delimiterOf(line: string): string {
  const counts = [";", ",", "\t"].map((delimiter) => ({
    delimiter,
    count: line.split(delimiter).length,
  }));
  return counts.reduce((best, entry) =>
    entry.count > best.count ? entry : best,
  ).delimiter;
}

/** Splits CSV text into rows; quoted fields may hold delimiters, quotes and line breaks. */
function readCsvRows(text: string): string[][] {
  const delimiter = delimiterOf(text.split("\n", 1)[0] ?? "");
  const rows: string[][] = [[]];
  let field = "";
  let isQuoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const row = rows[rows.length - 1];
    if (isQuoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') isQuoted = false;
      else field += character;
    } else if (character === '"' && field === "") isQuoted = true;
    else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      field = "";
      if (rows.length > PREVIEW_ROWS) break;
      rows.push([]);
    } else field += character;
  }
  if (field !== "") rows[rows.length - 1].push(field);
  return rows.filter((row) => row.length > 0);
}

function boundRows(
  rows: readonly (readonly string[])[],
  isCut: boolean,
): { rows: string[][]; isTruncated: boolean } {
  const isWide = rows.some((row) => row.length > PREVIEW_COLUMNS);
  return {
    rows: rows
      .slice(0, PREVIEW_ROWS)
      .map((row) =>
        row.slice(0, PREVIEW_COLUMNS).map((cell) => cut(cell, 500).text),
      ),
    isTruncated: isCut || isWide || rows.length > PREVIEW_ROWS,
  };
}

function formatJson(text: string, isCut: boolean): string {
  if (isCut) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (caughtError: unknown) {
    logCaughtError("ChatAttachmentPreviews", caughtError);

    // Invalid JSON is shown as it is.
    return text;
  }
}

async function previewText(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
): Promise<ChatAttachmentPreview> {
  const read = cut(
    await reader.readText(attachment, PREVIEW_CHARACTERS + 1),
    PREVIEW_CHARACTERS,
  );
  if (attachment.contentType === "text/csv")
    return {
      kind: "table",
      sheet: null,
      ...boundRows(readCsvRows(read.text), read.isCut),
    };
  return {
    kind: "text",
    text:
      attachment.contentType === "application/json"
        ? formatJson(read.text, read.isCut)
        : read.text,
    isTruncated: read.isCut,
  };
}

function previewSections(document: ChatDocument): ChatAttachmentPreview {
  const sections: ChatPreviewSection[] = [];
  let left = PREVIEW_CHARACTERS;
  for (const section of document.sections) {
    if (left <= 0) break;
    const shown = cut(section.text, left);
    sections.push({ ...section, text: shown.text });
    left -= Array.from(shown.text).length;
  }
  return {
    kind: "sections",
    sections,
    isTruncated:
      document.isTruncated ||
      sections.length < document.sections.length ||
      left <= 0,
  };
}

async function previewDocument(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
): Promise<ChatAttachmentPreview> {
  const bytes = await reader.readBytes(attachment, CHAT_DOCUMENT_BYTES);
  if (bytes === null) return { kind: "unavailable", reason: "tooLarge" };
  const reading = await readChatDocument(attachment.contentType, bytes);
  if (reading.status !== "read")
    return { kind: "unavailable", reason: reading.status };
  const [sheet] = reading.document.sheets;
  if (sheet === undefined) return previewSections(reading.document);
  return {
    kind: "table",
    sheet: sheet.name,
    ...boundRows(
      sheet.rows,
      reading.document.isTruncated || reading.document.sheets.length > 1,
    ),
  };
}

/**
 * Reads the bounded content preview of a text, PDF or Office attachment (PAGE-92).
 *
 * @remarks
 * The preview is plain data the browser shows as text: HTML and source code
 * stay text, a CSV file and the first sheet of a workbook become a table of
 * at most 200 rows. A failed conversion names its reason instead of an empty
 * preview. Nothing of the content is logged.
 */
export async function readChatAttachmentPreview(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
): Promise<ChatAttachmentPreview> {
  try {
    if (isChatTextAttachment(attachment.contentType))
      return await previewText(attachment, reader);
    if (isChatDocumentType(attachment.contentType))
      return await previewDocument(attachment, reader);
    return { kind: "unavailable", reason: "unsupported" };
  } catch (caughtError: unknown) {
    logCaughtError("ChatAttachmentPreviews", caughtError);

    return { kind: "unavailable", reason: "unreadable" };
  }
}
