/**
 * Contracts of the content of conversation messages (PAGE-298): attachments,
 * links and the state of the cards that show them. Shared by the web chat
 * page and Pica Mobile (`conversations.v1`).
 */

import { z } from "zod";

/** Largest attachment of a conversation message, in bytes: 512 MB. */
export const CONVERSATION_ATTACHMENT_MAXIMUM_BYTES = 512 * 1024 * 1024;

/** Most attachments one message carries. */
export const CONVERSATION_ATTACHMENT_MAXIMUM_COUNT = 10;

/** Largest preview image of an attachment, in bytes. */
export const CONVERSATION_THUMBNAIL_MAXIMUM_BYTES = 1024 * 1024;

/** The image types a preview image may have. */
export const CONVERSATION_THUMBNAIL_MIME_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const;

/** Narrowest split view and narrowest chat next to it, in pixels. */
export const CHAT_SPLIT_MINIMUM_WIDTH = 360;

/** Below this viewport width "Daneben" opens as full screen. */
export const CHAT_SPLIT_MINIMUM_VIEWPORT = 1100;

/** How the chat shows an attachment, decided from its MIME type. */
export type ConversationAttachmentKind =
  "image" | "video" | "audio" | "pdf" | "file";

/** A file of a message, as every client sees it. */
export interface ConversationAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly kind: ConversationAttachmentKind;
  /**
   * The address of the original. It asks for the same sign-in as every other
   * request of the client and answers byte ranges.
   */
  readonly url: string;
  /** The address of the preview image; missing until one was uploaded. */
  readonly thumbnailUrl?: string;
}

/** A URL that stands alone in a line of a message. */
export interface ConversationLink {
  readonly url: string;
  readonly domain: string;
  /** Empty until the server knows it, and when the page gave no answer. */
  readonly title: string;
  readonly description: string;
  /** The preview image as Pages serves it; `null` without one. */
  readonly imageUrl: string | null;
  /** Whether the domain may be embedded in this conversation. */
  readonly embeddable: boolean;
}

/** Whether a person collapsed or expanded a content card. */
export type ChatCardState = "collapsed" | "expanded";

/** What a person chose for the content cards and the split view. */
export interface ChatViewPreferences {
  /** The last chosen state by card key; cards without an entry keep their default. */
  readonly cardStates: Readonly<Record<string, ChatCardState>>;
  /** The last width of the split view in pixels; `null` before the first change. */
  readonly splitWidth: number | null;
  /** Whether the list of the chat page is collapsed to its bar (PAGE-325). */
  readonly isListCollapsed?: boolean;
}

/** The domains that may be embedded, as the chat page reads them. */
export interface ChatEmbedDomains {
  /** Released by an administrator for every conversation. */
  readonly global: readonly string[];
  /** Released by a member, by conversation ID. */
  readonly byConversation: Readonly<Record<string, readonly string[]>>;
}

/** IDs of Pages are short, printable and never a path. */
const identifierSchema = z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u);

/** The attachments a message is sent with, in their order. */
export const conversationAttachmentIdsSchema = z
  .array(identifierSchema)
  .max(CONVERSATION_ATTACHMENT_MAXIMUM_COUNT)
  .refine((ids) => new Set(ids).size === ids.length);

/** The name of an uploaded file: one path segment without control characters. */
export const conversationAttachmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/u);

/** A host name as an embed release stores it: lower case, without a port. */
export const conversationEmbedDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u,
  );

/** A change of the state of one content card. */
export const chatCardStateSchema = z.object({
  cardKey: z.string().regex(/^[\w:.-]{1,200}$/u),
  state: z.enum(["collapsed", "expanded"]),
});

/** A change of the width of the split view. */
export const chatSplitWidthSchema = z.coerce
  .number()
  .int()
  .min(CHAT_SPLIT_MINIMUM_WIDTH)
  .max(10_000);

/** Whether the list of the chat page is collapsed, as a form sends it (PAGE-325). */
export const chatListCollapsedSchema = z
  .enum(["true", "false"])
  .transform((choice) => choice === "true");

/**
 * Decides how the chat shows a file from its MIME type.
 *
 * @param mimeType - The stored type of the file.
 * @returns The kind of card.
 */
export function conversationAttachmentKind(
  mimeType: string,
): ConversationAttachmentKind {
  const type = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}
