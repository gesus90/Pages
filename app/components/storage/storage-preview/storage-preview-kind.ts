import { documentFormatOf } from "@/app/components/chat-page/content/documents/document-kinds";
import { GOOGLE_DOCUMENT_MIME_TYPES } from "@/backend/google/GoogleDriveFormats";
import { CHAT_DOCUMENT_BYTES } from "@/definition/ChatPreview";
import { STORAGE_MAX_READ_BYTES } from "@/definition/GoogleDriveFiles";

import type { DocumentFormat } from "@/app/components/chat-page/content/documents/document-kinds";

/** How the preview shows a file. */
export type StoragePreviewKind = "markdown" | "text" | "pdf" | "document";

/** What the preview needs to know about a file to choose its view. */
export interface StoragePreviewSubject {
  readonly name: string;
  readonly mimeType: string;
  /** The export formats Drive offers for a Google document, else empty. */
  readonly exportFormats: readonly string[];
}

/** How one file is loaded and shown. */
export interface StoragePreviewPlan {
  readonly kind: StoragePreviewKind;
  /** The format of a `document`, else `null`. */
  readonly format: DocumentFormat | null;
  /** The export format a Google document is loaded as, else `null`. */
  readonly exportFormat: string | null;
  /** The most bytes read; a larger file is not shown. */
  readonly limitBytes: number;
}

/** The only export of a native Google document the preview shows. */
const PDF_TYPE = "application/pdf";

/** The Google documents the preview shows as their PDF export. */
const GOOGLE_PREVIEW_TYPES: ReadonlySet<string> = new Set([
  GOOGLE_DOCUMENT_MIME_TYPES.document,
  GOOGLE_DOCUMENT_MIME_TYPES.presentation,
  GOOGLE_DOCUMENT_MIME_TYPES.spreadsheet,
]);

const MARKDOWN_ENDINGS: ReadonlySet<string> = new Set(["md", "markdown"]);
const MARKDOWN_TYPES: ReadonlySet<string> = new Set([
  "text/markdown",
  "text/x-markdown",
]);

const PDF_ENDINGS: ReadonlySet<string> = new Set(["pdf"]);
const PDF_TYPES: ReadonlySet<string> = new Set([PDF_TYPE, "application/x-pdf"]);

/** File endings of the text files that are shown as plain text. */
const TEXT_ENDINGS: ReadonlySet<string> = new Set([
  "txt",
  "text",
  "log",
  "json",
  "jsonl",
  "ndjson",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "xhtml",
  "svg",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "ini",
  "toml",
  "conf",
  "cfg",
  "properties",
  "sh",
  "bash",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "sql",
  "diff",
  "patch",
  "rst",
  "tex",
  "srt",
]);

/** Text types beside `text/*` that are shown as plain text. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/x-yaml",
  "application/yaml",
  "application/x-sh",
  "application/sql",
  "image/svg+xml",
]);

/** The lowercase file ending of a name; empty without one. */
function endingOf(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The type without parameters, in lowercase. */
function baseTypeOf(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isTextType(baseType: string): boolean {
  return (
    baseType.startsWith("text/") ||
    TEXT_TYPES.has(baseType) ||
    baseType.endsWith("+json") ||
    baseType.endsWith("+xml")
  );
}

function plan(
  kind: StoragePreviewKind,
  limitBytes: number,
  details: Partial<Pick<StoragePreviewPlan, "format" | "exportFormat">> = {},
): StoragePreviewPlan {
  return {
    exportFormat: details.exportFormat ?? null,
    format: details.format ?? null,
    kind,
    limitBytes,
  };
}

function documentPlan(format: DocumentFormat): StoragePreviewPlan {
  return plan("document", CHAT_DOCUMENT_BYTES, { format });
}

function planOfGoogleDocument(
  subject: StoragePreviewSubject,
): StoragePreviewPlan | null {
  return subject.exportFormats.includes(PDF_TYPE)
    ? plan("pdf", CHAT_DOCUMENT_BYTES, { exportFormat: PDF_TYPE })
    : null;
}

/** The kind by the file ending, which is the more reliable hint of the two. */
function planOfEnding(name: string): StoragePreviewPlan | null {
  const ending = endingOf(name);
  const format = documentFormatOf({ mimeType: "", name });

  if (format !== null) return documentPlan(format);
  if (MARKDOWN_ENDINGS.has(ending)) {
    return plan("markdown", STORAGE_MAX_READ_BYTES);
  }

  if (PDF_ENDINGS.has(ending)) return plan("pdf", CHAT_DOCUMENT_BYTES);

  if (TEXT_ENDINGS.has(ending)) return plan("text", STORAGE_MAX_READ_BYTES);

  return null;
}

/** The kind by the type, for a name whose ending says nothing. */
function planOfType(mimeType: string): StoragePreviewPlan | null {
  const baseType = baseTypeOf(mimeType);
  const format = documentFormatOf({ mimeType, name: "" });

  if (format !== null) return documentPlan(format);
  if (MARKDOWN_TYPES.has(baseType)) {
    return plan("markdown", STORAGE_MAX_READ_BYTES);
  }

  if (PDF_TYPES.has(baseType)) return plan("pdf", CHAT_DOCUMENT_BYTES);

  if (isTextType(baseType)) return plan("text", STORAGE_MAX_READ_BYTES);

  return null;
}

/**
 * Decides how a file is previewed inside Storage.
 * @param subject - Name, type and the export formats Drive offers.
 * @returns The view, the export and the byte limit; `null` when the file has
 * no preview: an unknown or generic binary file, an old Office format, or a
 * Google document without PDF export.
 * @remarks
 * Google's own documents, sheets and presentations are shown as their PDF
 * export. Every other file is decided by its ending first and by its type
 * second, so a Markdown file with the type `application/octet-stream` or
 * `text/plain` is still Markdown. A file with an unknown ending and a
 * generic type is never read as text.
 */
export function storagePreviewPlanOf(
  subject: StoragePreviewSubject,
): StoragePreviewPlan | null {
  if (GOOGLE_PREVIEW_TYPES.has(baseTypeOf(subject.mimeType))) {
    return planOfGoogleDocument(subject);
  }

  return planOfEnding(subject.name) ?? planOfType(subject.mimeType);
}
