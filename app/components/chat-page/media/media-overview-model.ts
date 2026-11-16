import { fileViewOf } from "../content/documents/document-kinds";
import { textAttachmentKind } from "../content/message-content";

import type { ConversationImage } from "@/definition/ConversationContent";
import type {
  ConversationMediaFile,
  ConversationMediaSender,
} from "@/definition/ConversationMediaOverview";
import type { ContentCardDescriptor, OpenedCard } from "../content/card-types";

/** The files of one month, as the grids of images and videos group them. */
export interface MediaMonthGroup {
  /** `2026-11`; stable for the list. */
  readonly key: string;
  /** "November 2026" in the language of the interface. */
  readonly label: string;
  readonly files: readonly ConversationMediaFile[];
}

/**
 * Groups files by the month they were sent in, keeping their order.
 * @param files - The files, newest first.
 * @param language - The language of the interface, for the names of the months.
 */
export function groupByMonth(
  files: readonly ConversationMediaFile[],
  language: string,
): MediaMonthGroup[] {
  const format = new Intl.DateTimeFormat(language, {
    month: "long",
    year: "numeric",
  });
  const groups: {
    key: string;
    label: string;
    files: ConversationMediaFile[];
  }[] = [];
  for (const file of files) {
    const sent = new Date(file.sentAt);
    const key = Number.isNaN(sent.getTime()) ? "" : file.sentAt.slice(0, 7);
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = { key, label: key === "" ? "" : format.format(sent), files: [] };
      groups.push(group);
    }
    group.files.push(file);
  }
  return groups;
}

/** The card a document, a sound or another file opens as next to the chat. */
function descriptorOf(file: ConversationMediaFile): ContentCardDescriptor {
  const { attachment } = file;
  if (
    attachment.kind === "image" ||
    attachment.kind === "video" ||
    attachment.kind === "audio"
  )
    return { kind: attachment.kind, attachment };
  const view = fileViewOf(attachment);
  if (view.kind === "pdf") return { kind: "pdf", attachment };
  if (view.kind === "document")
    return { kind: view.view, attachment, format: view.format };
  const text = view.isTooLarge ? null : textAttachmentKind(attachment);
  if (text === null) return { kind: "file", attachment };
  const shared = {
    name: attachment.name,
    source: null,
    sourceUrl: attachment.url,
  };
  if (text === "code")
    return { ...shared, kind: "code", languageHint: attachment.name };
  return { ...shared, kind: text };
}

/**
 * The card of a file of the overview, as the split view, the full screen and
 * the video viewer open it.
 * @param file - The file with its message.
 * @param senderName - The name of its sender.
 */
export function mediaCardOf(
  file: ConversationMediaFile,
  senderName: string,
): OpenedCard {
  return {
    key: `att:${file.attachment.id}`,
    descriptor: descriptorOf(file),
    origin: { senderName, createdAt: file.sentAt, messageId: file.messageId },
  };
}

/**
 * An image of the overview as the image viewer takes it.
 *
 * @param file - The image with its message.
 * @param senderName - The name of its sender.
 */
export function mediaImageOf(
  file: ConversationMediaFile,
  senderName: string,
): ConversationImage {
  return {
    attachment: file.attachment,
    messageId: file.messageId,
    senderId: file.senderId,
    senderName,
    sentAt: file.sentAt,
  };
}

/**
 * The name of a sender of the overview.
 *
 * @param senders - The senders the overview lists.
 * @param senderId - The account.
 * @returns The name, or an empty text for an unknown account.
 */
export function senderNameOf(
  senders: readonly ConversationMediaSender[],
  senderId: string,
): string {
  return senders.find((sender) => sender.id === senderId)?.name ?? "";
}
