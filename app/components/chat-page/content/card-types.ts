import type {
  ConversationAttachment,
  ConversationLink,
} from "@/definition/ConversationContent";

/** Text a card shows: given with the message, or loaded from an attachment. */
export interface CardText {
  /** The text itself; `null` while it has to be loaded from `sourceUrl`. */
  readonly source: string | null;
  /** The address of the attachment that holds the text. */
  readonly sourceUrl?: string;
}

/** What one content card of the chat shows (PAGE-298). */
export type ContentCardDescriptor =
  | (CardText & {
      readonly kind: "code";
      readonly name: string;
      /** The info of the code fence or the file name; decides the language. */
      readonly languageHint: string;
    })
  | (CardText & { readonly kind: "diff"; readonly name: string })
  | (CardText & { readonly kind: "markdown"; readonly name: string })
  | {
      readonly kind: "image" | "pdf" | "video" | "audio" | "file";
      readonly attachment: ConversationAttachment;
    }
  | { readonly kind: "web"; readonly link: ConversationLink }
  | { readonly kind: "link"; readonly link: ConversationLink };

/** Who sent the message of a card and when, for the head of the split view. */
export interface CardOrigin {
  readonly senderName: string;
  /** ISO time the message was stored; missing for one still on its way. */
  readonly createdAt?: string;
}

/** A card with its key, as the split view and the full screen open it. */
export interface OpenedCard {
  /** Stable per message and card; the stored state is kept under it. */
  readonly key: string;
  readonly descriptor: ContentCardDescriptor;
  readonly origin: CardOrigin;
}

/** Largest text attachment the chat renders as code, diff or Markdown: 1 MB. */
export const CARD_TEXT_MAXIMUM_BYTES = 1024 * 1024;

/**
 * Formats a file size for a card head.
 *
 * @param bytes - The size in bytes.
 * @param language - The language of the interface, for the decimal sign.
 * @returns For example `172 KB` or `1,2 MB`.
 */
export function formatFileSize(bytes: number, language: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit > 1 && size < 100 ? 1 : 0;
  const text = new Intl.NumberFormat(language, {
    maximumFractionDigits: digits,
  }).format(size);
  return `${text} ${units[unit] ?? "B"}`;
}

/**
 * The address that sends an attachment as a download with its name.
 *
 * @param attachment - The attachment.
 */
export function downloadUrl(attachment: ConversationAttachment): string {
  return `${attachment.url}?download=1`;
}
