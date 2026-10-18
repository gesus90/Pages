import { logCaughtError } from "@/backend/logging/Logger";
import {
  CHAT_DOCUMENT_BYTES,
  CHAT_OFFICE_TYPES,
} from "@/definition/ChatPreview";

import { readOfficeDocument } from "./ChatOfficeText";
import { readPdfDocument } from "./ChatPdfText";
import { ChatZipError } from "./ChatZipArchive";

import type {
  ChatPreviewSection,
  ChatPreviewUnavailableReason,
} from "@/definition/ChatPreview";

export { CHAT_DOCUMENT_BYTES } from "@/definition/ChatPreview";

/** One sheet of a workbook with its rows. */
export interface ChatDocumentSheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

/** The text of a document, as pages, slides or sheets. */
export interface ChatDocument {
  readonly sections: readonly ChatPreviewSection[];
  readonly sheets: readonly ChatDocumentSheet[];
  /** For a PDF: how many pages were read, of how many. */
  readonly pages?: { readonly read: number; readonly total: number };
  /** Parts of the document were not read, such as pages beyond the limit. */
  readonly isTruncated: boolean;
}

/** The text of a document, or why it has none that Pages can read. */
export type ChatDocumentReading =
  | { readonly status: "read"; readonly document: ChatDocument }
  | { readonly status: ChatPreviewUnavailableReason };

/** The text of a document cut for the agent. */
export interface ChatDocumentText {
  readonly text: string;
  /** Characters of the text before it was cut. */
  readonly characters: number;
  readonly isTruncated: boolean;
}

/** Tells whether Pages reads the text of attachments of this type as a document. */
export function isChatDocumentType(contentType: string): boolean {
  return (
    contentType === "application/pdf" ||
    Object.values<string>(CHAT_OFFICE_TYPES).includes(contentType)
  );
}

/**
 * Reads the text of a PDF or an accepted Office document (PAGE-92).
 *
 * @param contentType - The type Pages determined at the upload.
 * @param bytes - The complete file; at most {@link CHAT_DOCUMENT_BYTES}.
 * @returns The document, or why its text cannot be read.
 */
export async function readChatDocument(
  contentType: string,
  bytes: Buffer,
): Promise<ChatDocumentReading> {
  if (bytes.length > CHAT_DOCUMENT_BYTES) return { status: "tooLarge" };
  if (contentType === "application/pdf") return readPdfDocument(bytes);
  try {
    const document = readOfficeDocument(contentType, bytes);
    if (document === null) return { status: "unsupported" };
    return document.sections.length === 0 &&
      document.sheets.every((sheet) => sheet.rows.length === 0)
      ? { status: "noText" }
      : { status: "read", document };
  } catch (caughtError: unknown) {
    logCaughtError("ChatDocumentReader", caughtError);

    return {
      status:
        caughtError instanceof ChatZipError ? caughtError.reason : "unreadable",
    };
  }
}

function sectionHeading(section: ChatPreviewSection): string {
  if (section.kind === "page") return `Seite ${section.number}:`;
  if (section.kind === "slide") return `Folie ${section.number}:`;
  return "";
}

/**
 * Writes a document as plain text for the agent, cut after a number of characters.
 *
 * @param document - The text the document holds.
 * @param maximumCharacters - How much text the agent receives at most.
 */
export function chatDocumentText(
  document: ChatDocument,
  maximumCharacters: number,
): ChatDocumentText {
  const parts = [
    ...document.sections.map((section) =>
      [sectionHeading(section), section.text].filter(Boolean).join("\n"),
    ),
    ...document.sheets.map((sheet) =>
      [
        `Tabelle ${JSON.stringify(sheet.name)}:`,
        ...sheet.rows.map((row) => row.join("\t")),
      ].join("\n"),
    ),
  ];
  const characters = Array.from(parts.join("\n\n"));
  return {
    text: characters.slice(0, maximumCharacters).join(""),
    characters: characters.length,
    isTruncated: document.isTruncated || characters.length > maximumCharacters,
  };
}
