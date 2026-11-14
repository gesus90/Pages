import type {
  ConversationAttachment,
  ConversationAttachmentKind,
} from "./ConversationContent";
import type { ConversationParticipantKind } from "./Conversation";

/** The tabs of "Medien & Dateien" of a chat, in their order (PAGE-387). */
export const CONVERSATION_MEDIA_TABS = [
  "images",
  "videos",
  "audio",
  "documents",
  "files",
  "links",
] as const;

/** One tab of "Medien & Dateien". */
export type ConversationMediaTab = (typeof CONVERSATION_MEDIA_TABS)[number];

/** The tabs that list files; links have their own. */
export type ConversationMediaFileTab = Exclude<ConversationMediaTab, "links">;

/** A file of an agent counts as expiring soon below this remaining time: 24 hours. */
export const CONVERSATION_MEDIA_EXPIRING_SOON_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Most files one ZIP of the overview takes. */
export const CONVERSATION_MEDIA_ARCHIVE_MAXIMUM = 200;

/** Endings of documents: PDF, Office and OpenDocument, tables and text. */
const DOCUMENT_ENDINGS: readonly string[] = [
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "ppt",
  "pptx",
  "odp",
  "key",
  "pages",
  "xls",
  "xlsx",
  "ods",
  "numbers",
  "csv",
  "tsv",
  "txt",
  "md",
  "markdown",
  "log",
];

/** Types of documents beyond `text/*`. */
const DOCUMENT_TYPE_PARTS: readonly string[] = [
  "msword",
  "officedocument",
  "opendocument",
  "ms-excel",
  "ms-powerpoint",
  "rtf",
  "csv",
];

/** Who sent files or links into the chat, for the filter by sender. */
export interface ConversationMediaSender {
  readonly id: string;
  readonly name: string;
  readonly kind: ConversationParticipantKind;
}

/** A file of a sent message of the chat, sorted into its tab. */
export interface ConversationMediaFile {
  readonly tab: ConversationMediaFileTab;
  readonly attachment: ConversationAttachment;
  readonly messageId: string;
  readonly senderId: string;
  /** When the message was sent. */
  readonly sentAt: string;
}

/** A link of a sent message of the chat. */
export interface ConversationMediaLink {
  readonly url: string;
  readonly domain: string;
  /** The title of the page as Pages knows it, else the text of the link; may be empty. */
  readonly title: string;
  /** The stored preview image of the page; `null` without one. */
  readonly imageUrl: string | null;
  readonly messageId: string;
  readonly senderId: string;
  readonly sentAt: string;
}

/** Everything the chat shared: files and links, newest first, and their senders. */
export interface ConversationMediaOverview {
  readonly conversationId: string;
  readonly files: readonly ConversationMediaFile[];
  readonly links: readonly ConversationMediaLink[];
  readonly senders: readonly ConversationMediaSender[];
}

/** The search and the filters of the overview. */
export interface ConversationMediaFilter {
  /** Part of a file name or of a link title, domain or address; empty finds everything. */
  readonly query: string;
  /** Only what this person or agent sent; `null` for everybody. */
  readonly senderId: string | null;
  /** Only files of agents with less than 24 hours left. */
  readonly isExpiringSoon: boolean;
  /** Leaves expired files out instead of showing their placeholder. */
  readonly isExpiredHidden: boolean;
}

/** The filter that shows everything. */
export const OPEN_MEDIA_FILTER: ConversationMediaFilter = {
  query: "",
  senderId: null,
  isExpiringSoon: false,
  isExpiredHidden: false,
};

function endingOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isDocument(name: string, mimeType: string): boolean {
  if (DOCUMENT_ENDINGS.includes(endingOf(name))) return true;
  const type = mimeType.toLowerCase();
  if (type.startsWith("text/")) return true;
  return DOCUMENT_TYPE_PARTS.some((part) => type.includes(part));
}

/**
 * The tab of a file (PAGE-387): images, videos and sound by their kind; PDF,
 * Office, tables and text as documents; binary files and everything else as
 * files.
 *
 * @param attachment - Name, type and kind of the file.
 */
export function conversationMediaTab(
  attachment: Pick<ConversationAttachment, "name" | "mimeType"> & {
    readonly kind: ConversationAttachmentKind;
  },
): ConversationMediaFileTab {
  if (attachment.kind === "image") return "images";
  if (attachment.kind === "video") return "videos";
  if (attachment.kind === "audio") return "audio";
  if (attachment.kind === "pdf") return "documents";
  return isDocument(attachment.name, attachment.mimeType)
    ? "documents"
    : "files";
}

/**
 * Whether the file of an attachment is gone: removed, or its time ran out.
 *
 * @param attachment - The attachment.
 * @param now - The current moment in milliseconds.
 */
export function isMediaExpired(
  attachment: Pick<ConversationAttachment, "expiresAt" | "expiredAt">,
  now: number,
): boolean {
  if (attachment.expiredAt !== undefined) return true;
  return (
    attachment.expiresAt !== undefined && Date.parse(attachment.expiresAt) <= now
  );
}

/**
 * Whether a file of an agent has less than 24 hours left and is still there.
 *
 * @param attachment - The attachment.
 * @param now - The current moment in milliseconds.
 */
export function isMediaExpiringSoon(
  attachment: Pick<ConversationAttachment, "expiresAt" | "expiredAt">,
  now: number,
): boolean {
  if (attachment.expiresAt === undefined || isMediaExpired(attachment, now))
    return false;
  return (
    Date.parse(attachment.expiresAt) - now <
    CONVERSATION_MEDIA_EXPIRING_SOON_MILLISECONDS
  );
}

function matchesQuery(texts: readonly string[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return texts.some((text) => text.toLocaleLowerCase().includes(needle));
}

/**
 * The files the search and the filters leave, in their order.
 *
 * @param files - The files of the chat.
 * @param filter - Search, sender and the filters of the remaining time.
 * @param now - The current moment in milliseconds.
 */
export function filterMediaFiles(
  files: readonly ConversationMediaFile[],
  filter: ConversationMediaFilter,
  now: number,
): ConversationMediaFile[] {
  return files.filter((file) => {
    if (filter.senderId !== null && file.senderId !== filter.senderId)
      return false;
    if (!matchesQuery([file.attachment.name], filter.query)) return false;
    if (filter.isExpiringSoon && !isMediaExpiringSoon(file.attachment, now))
      return false;
    return !(filter.isExpiredHidden && isMediaExpired(file.attachment, now));
  });
}

/**
 * The links the search and the sender filter leave; the filters of the
 * remaining time leave no link, since links never expire.
 *
 * @param links - The links of the chat.
 * @param filter - Search and sender.
 */
export function filterMediaLinks(
  links: readonly ConversationMediaLink[],
  filter: ConversationMediaFilter,
): ConversationMediaLink[] {
  if (filter.isExpiringSoon) return [];
  return links.filter(
    (link) =>
      (filter.senderId === null || link.senderId === filter.senderId) &&
      matchesQuery([link.title, link.domain, link.url], filter.query),
  );
}

/**
 * How many entries each tab holds.
 *
 * @param files - The files to count.
 * @param links - The links to count.
 */
export function mediaTabCounts(
  files: readonly Pick<ConversationMediaFile, "tab">[],
  links: readonly unknown[],
): Record<ConversationMediaTab, number> {
  const counts: Record<ConversationMediaTab, number> = {
    images: 0,
    videos: 0,
    audio: 0,
    documents: 0,
    files: 0,
    links: links.length,
  };
  for (const file of files) counts[file.tab] += 1;
  return counts;
}

/** The address of the overview of a chat. */
export function mediaOverviewUrl(conversationId: string): string {
  return `/chat/media/${encodeURIComponent(conversationId)}`;
}

/**
 * The address of one ZIP archive of chosen files of a chat.
 *
 * @param conversationId - The chat.
 * @param attachmentIds - The chosen files.
 */
export function mediaArchiveUrl(
  conversationId: string,
  attachmentIds: readonly string[],
): string {
  const ids = encodeURIComponent(attachmentIds.join(","));
  return `${mediaOverviewUrl(conversationId)}/files.zip?ids=${ids}`;
}
