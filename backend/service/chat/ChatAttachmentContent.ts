import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { MAX_TICKET_ASSET_BYTES } from "@/backend/service/agents/AgentTicketAssetService";

import {
  CHAT_DOCUMENT_BYTES,
  chatDocumentText,
  isChatDocumentType,
  readChatDocument,
} from "./ChatDocumentReader";

import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type {
  ChatSelectionItem,
  ChatSelectionScope,
  ChatSelectionTransfer,
} from "@/definition/ChatJob";
import type { ChatAttachmentService } from "./ChatAttachmentService";

/** Characters of one text attachment the agent receives. */
export const CHAT_ATTACHMENT_CHARACTERS = 30_000;

/** Raster images models read; SVG and other images are named but not sent. */
export const CHAT_AGENT_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Reads the selected attachments of a message, and nothing else. */
export type ChatAttachmentReader = Pick<
  ChatAttachmentService,
  "readText" | "readBytes"
>;

/**
 * What of one attachment reaches the agent (PAGE-92).
 *
 * @remarks
 * `text` is the text of a text file or the extracted text of a document,
 * `image` the bytes of a raster image, `none` an attachment whose content does
 * not reach the agent; every kind carries its transfer status, so nothing is
 * left out without a trace.
 */
export type ChatAgentAttachment =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly transfer: "full" | "extracted" | "truncated";
      readonly scope?: ChatSelectionScope;
      /** The text was extracted from a document, without its layout and images. */
      readonly isExtracted: boolean;
    }
  | {
      readonly kind: "image";
      readonly data: Buffer;
      readonly transfer: "full";
    }
  | {
      readonly kind: "none";
      readonly transfer: Exclude<
        ChatSelectionTransfer,
        "full" | "extracted" | "truncated"
      >;
    };

/** Tells whether an attachment reaches the agent as text. */
export function isChatTextAttachment(contentType: string): boolean {
  return contentType.startsWith("text/") || contentType === "application/json";
}

async function readTextFile(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
): Promise<ChatAgentAttachment> {
  const read = Array.from(
    await reader.readText(attachment, CHAT_ATTACHMENT_CHARACTERS + 1),
  );
  const isTruncated = read.length > CHAT_ATTACHMENT_CHARACTERS;
  const text = read.slice(0, CHAT_ATTACHMENT_CHARACTERS).join("");
  return {
    kind: "text",
    text: redactCredentials(text),
    transfer: isTruncated ? "truncated" : "full",
    ...(isTruncated
      ? { scope: { characters: CHAT_ATTACHMENT_CHARACTERS } }
      : {}),
    isExtracted: false,
  };
}

async function readDocument(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
): Promise<ChatAgentAttachment> {
  const bytes = await reader.readBytes(attachment, CHAT_DOCUMENT_BYTES);
  if (bytes === null) return { kind: "none", transfer: "tooLarge" };
  const reading = await readChatDocument(attachment.contentType, bytes);
  if (reading.status !== "read")
    return { kind: "none", transfer: reading.status };
  const extracted = chatDocumentText(
    reading.document,
    CHAT_ATTACHMENT_CHARACTERS,
  );
  const { pages } = reading.document;
  return {
    kind: "text",
    text: redactCredentials(extracted.text),
    transfer: extracted.isTruncated ? "truncated" : "extracted",
    ...(extracted.isTruncated
      ? {
          scope: {
            characters: Array.from(extracted.text).length,
            ...(pages ? { pages } : {}),
          },
        }
      : {}),
    isExtracted: true,
  };
}

async function readImage(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
): Promise<ChatAgentAttachment> {
  const bytes = await reader.readBytes(attachment, MAX_TICKET_ASSET_BYTES);
  return bytes === null
    ? { kind: "none", transfer: "tooLarge" }
    : { kind: "image", data: bytes, transfer: "full" };
}

/**
 * Reads what of one selected attachment reaches the agent.
 *
 * @param attachment - An attachment of the message, whose owner was checked.
 * @param reader - Reads its file; no other file is opened.
 * @param canSendImages - Whether the path to the agent takes image content.
 */
export async function readChatAgentAttachment(
  attachment: StoredChatAttachment,
  reader: ChatAttachmentReader,
  canSendImages: boolean,
): Promise<ChatAgentAttachment> {
  try {
    if (isChatTextAttachment(attachment.contentType))
      return await readTextFile(attachment, reader);
    if (isChatDocumentType(attachment.contentType))
      return await readDocument(attachment, reader);
    if (CHAT_AGENT_IMAGE_TYPES.has(attachment.contentType))
      return canSendImages
        ? await readImage(attachment, reader)
        : { kind: "none", transfer: "unsupported" };
    return { kind: "none", transfer: "unsupported" };
  } catch (caughtError: unknown) {
    logCaughtError("ChatAttachmentContent", caughtError);

    // A missing or unreadable file is reported, never silently left out.
    return { kind: "none", transfer: "unreadable" };
  }
}

/** The snapshot entry of one attachment: what it is and how it reached the agent. */
export function chatSelectionItem(
  attachment: StoredChatAttachment,
  content: ChatAgentAttachment,
): ChatSelectionItem {
  return {
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    transfer: content.transfer,
    ...(content.kind === "text" && content.scope
      ? { scope: content.scope }
      : {}),
  };
}
