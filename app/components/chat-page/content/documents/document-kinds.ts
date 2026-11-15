import { CHAT_DOCUMENT_BYTES } from "@/definition/ChatPreview";

import type { ConversationAttachment } from "@/definition/ConversationContent";

/** The formats the chat shows as a readable view or a table (PAGE-385). */
export type DocumentFormat =
  "docx" | "odt" | "pptx" | "odp" | "xlsx" | "ods" | "csv" | "tsv";

/** How a format is shown: a document, slides or a table. */
export type DocumentView = "word" | "slides" | "sheet";

/** How the chat shows a file that is neither an image, a video nor a sound. */
export type FileView =
  | { readonly kind: "pdf" }
  | {
      readonly kind: "document";
      readonly format: DocumentFormat;
      readonly view: DocumentView;
    }
  | {
      /** Only offered for download: a binary file, an older format, or a document above the limit. */
      readonly kind: "binary";
      readonly isTooLarge: boolean;
    };

const VIEWS: Readonly<Record<DocumentFormat, DocumentView>> = {
  docx: "word",
  odt: "word",
  pptx: "slides",
  odp: "slides",
  xlsx: "sheet",
  ods: "sheet",
  csv: "sheet",
  tsv: "sheet",
};

const MIME_FORMATS: ReadonlyMap<string, DocumentFormat> = new Map([
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.oasis.opendocument.text", "odt"],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
  ],
  ["application/vnd.oasis.opendocument.presentation", "odp"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.oasis.opendocument.spreadsheet", "ods"],
  ["text/csv", "csv"],
  ["application/csv", "csv"],
  ["text/tab-separated-values", "tsv"],
]);

function isDocumentFormat(ending: string): ending is DocumentFormat {
  return Object.hasOwn(VIEWS, ending);
}

/**
 * The document format of a file: by the ending of its name, else by its type.
 *
 * @param attachment - The file.
 * @returns The format, or `null` for a file the chat shows no view of.
 */
export function documentFormatOf(
  attachment: Pick<ConversationAttachment, "name" | "mimeType">,
): DocumentFormat | null {
  const dot = attachment.name.lastIndexOf(".");
  const ending = dot > 0 ? attachment.name.slice(dot + 1).toLowerCase() : "";
  if (isDocumentFormat(ending)) return ending;
  return (
    MIME_FORMATS.get(
      attachment.mimeType.split(";")[0]?.trim().toLowerCase() ?? "",
    ) ?? null
  );
}

/**
 * Decides how the chat shows a file (PAGE-385): a PDF in its viewer, Word,
 * PowerPoint, OpenDocument and tables as readable views, anything else and
 * every document above the preview limit of Pages (32 MB) for download only.
 *
 * @param attachment - The file.
 */
export function fileViewOf(
  attachment: Pick<
    ConversationAttachment,
    "name" | "mimeType" | "sizeBytes" | "kind"
  >,
): FileView {
  const format = documentFormatOf(attachment);
  const isDocument = attachment.kind === "pdf" || format !== null;
  if (isDocument && attachment.sizeBytes > CHAT_DOCUMENT_BYTES)
    return { kind: "binary", isTooLarge: true };
  if (attachment.kind === "pdf") return { kind: "pdf" };
  if (format === null) return { kind: "binary", isTooLarge: false };
  return { kind: "document", format, view: VIEWS[format] };
}
