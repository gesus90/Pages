/** Raster images the browser shows as a thumbnail from the preview route. */
const CHAT_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** The Office types Pages accepts and reads as text (PAGE-92). */
export const CHAT_OFFICE_TYPES = {
  document:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  workbook: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  presentation:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

/**
 * The largest PDF or Office file whose content Pages reads for the agent and
 * the preview; larger files are named and downloaded only.
 */
export const CHAT_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** How the chat shows an attachment before it is downloaded. */
export type ChatPreviewKind = "image" | "pdf" | "content" | "none";

/** Why an attachment has no preview of its content. */
export type ChatPreviewUnavailableReason =
  "unsupported" | "tooLarge" | "encrypted" | "noText" | "unreadable";

/** One section of a document: the text of a document, a page or a slide. */
export interface ChatPreviewSection {
  readonly kind: "document" | "page" | "slide";
  /** The number of the page or slide, counted from 1. */
  readonly number: number;
  readonly text: string;
}

/**
 * The bounded, escaped-on-render content preview of a text or Office attachment.
 *
 * @remarks
 * Every text is plain data; the browser shows it as text, never as markup.
 * `isTruncated` marks a preview that holds only the start of the file.
 */
export type ChatAttachmentPreview =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly isTruncated: boolean;
    }
  | {
      readonly kind: "table";
      /** The name of the sheet the rows belong to; `null` for a CSV file. */
      readonly sheet: string | null;
      readonly rows: readonly (readonly string[])[];
      readonly isTruncated: boolean;
    }
  | {
      readonly kind: "sections";
      readonly sections: readonly ChatPreviewSection[];
      readonly isTruncated: boolean;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: ChatPreviewUnavailableReason;
    };

/**
 * Tells how the chat previews an attachment of this type.
 *
 * @param contentType - The type Pages determined from the content.
 * @returns `image` for a thumbnail, `pdf` for a page rendered in the browser,
 * `content` for a text, table or document preview, `none` without a preview.
 */
export function chatPreviewKind(contentType: string): ChatPreviewKind {
  if (CHAT_IMAGE_TYPES.has(contentType)) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    Object.values<string>(CHAT_OFFICE_TYPES).includes(contentType)
  )
    return "content";
  return "none";
}
