import { ConversationError } from "@/backend/error/ConversationError";
import {
  CONVERSATION_MEDIA_ARCHIVE_MAXIMUM,
  conversationMediaTab,
} from "@/definition/ConversationMediaOverview";

import {
  isConversationAttachmentExpired,
  toConversationAttachment,
} from "./ConversationAttachments";
import { conversationLinkImageUrl } from "./ConversationLinks";
import { findMessageLinks } from "./ConversationMessageLinks";

import type {
  ConversationAttachmentLibraryRepository,
  StoredLibraryAttachment,
} from "@/backend/database/repositories/conversation/ConversationAttachmentLibraryRepository";
import type { ConversationLinkPreviewRepository } from "@/backend/database/repositories/conversation/ConversationLinkPreviewRepository";
import type {
  ConversationMediaOverviewRepository,
  StoredLinkedMessage,
} from "@/backend/database/repositories/conversation/ConversationMediaOverviewRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ConversationParticipant } from "@/definition/Conversation";
import type {
  ConversationMediaFile,
  ConversationMediaLink,
  ConversationMediaOverview,
  ConversationMediaSender,
} from "@/definition/ConversationMediaOverview";
import type { User } from "@/definition/User";
import type { ConversationArchiveEntry } from "./ConversationZipArchive";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** The accounts of Pages by ID, with a stand-in for a removed one. */
interface MediaAccounts {
  participant(id: string): ConversationParticipant;
}

/** What "Medien & Dateien" of a chat reads (PAGE-387). */
export interface ConversationMediaOverviewDependencies {
  readonly library: Pick<
    ConversationAttachmentLibraryRepository,
    "attachments"
  >;
  readonly messages: Pick<
    ConversationMediaOverviewRepository,
    "linkedMessages"
  >;
  readonly previews: Pick<ConversationLinkPreviewRepository, "find">;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly files: Pick<WikiFileStore, "open">;
  readonly directory: { read(): Promise<MediaAccounts> };
  readonly now?: () => Date;
}

function readIdentifier(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new ConversationError("not_found");
  return input;
}

/**
 * Reads the chosen attachment IDs of a ZIP request: a list separated by
 * commas, each ID once, at most 200.
 *
 * @throws {ConversationError} `invalid` for no usable ID or too many.
 */
export function readMediaArchiveIds(input: unknown): string[] {
  const parts = typeof input === "string" ? input.split(",") : [];
  const ids = [...new Set(parts.map((part) => part.trim()))].filter((part) =>
    IDENTIFIER.test(part),
  );
  if (ids.length === 0 || ids.length > CONVERSATION_MEDIA_ARCHIVE_MAXIMUM)
    throw new ConversationError("invalid");
  return ids;
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

/**
 * "Medien & Dateien" of a chat (PAGE-387): every file and link its sent
 * messages hold, sorted into tabs, and chosen files as one ZIP archive.
 *
 * @remarks
 * Every request checks on the server that the account is a member of the
 * conversation now; any other answers `not_found`, as a missing one does.
 * Only sent messages count, so an upload not sent yet stays its uploader's
 * alone; a deleted message and a dissolved group are gone with their files.
 * A file of an agent whose 72 hours ran out stays as a placeholder with
 * `expiredAt` and never goes into an archive.
 */
export class ConversationMediaOverviewService {
  private readonly dependencies: ConversationMediaOverviewDependencies;

  public constructor(dependencies: ConversationMediaOverviewDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Lists the files and links of a chat for a member, newest first.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member.
   */
  public async overview(
    person: User,
    conversationId: unknown,
  ): Promise<ConversationMediaOverview> {
    const id = readIdentifier(conversationId);
    await this.requireMember(person.id, id);
    const [stored, messages, accounts] = await Promise.all([
      this.dependencies.library.attachments(id),
      this.dependencies.messages.linkedMessages(id),
      this.dependencies.directory.read(),
    ]);
    const files = stored.map((entry) => this.toFile(entry));
    const links = await this.linksOf(messages);
    return {
      conversationId: id,
      files,
      links,
      senders: sendersOf([...files, ...links], accounts),
    };
  }

  /**
   * The chosen files of a chat that are still there, for one ZIP archive.
   *
   * @param person - The signed-in account.
   * @param request - The chat and the comma-separated attachment IDs.
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member or when none of the files is there any more,
   * `invalid` for no usable ID or more than 200.
   */
  public async archive(
    person: User,
    request: { readonly conversationId: unknown; readonly ids: unknown },
  ): Promise<{ readonly entries: ConversationArchiveEntry[] }> {
    const id = readIdentifier(request.conversationId);
    const chosen = new Set(readMediaArchiveIds(request.ids));
    await this.requireMember(person.id, id);
    const now = this.now();
    const stored = await this.dependencies.library.attachments(id);
    const entries = stored
      .map((entry) => entry.attachment)
      .filter(
        (attachment) =>
          chosen.has(attachment.id) &&
          !isConversationAttachmentExpired(attachment, now),
      )
      .map((attachment) => ({
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
        open: () => this.dependencies.files.open(attachment.storageName),
      }));
    if (entries.length === 0) throw new ConversationError("not_found");
    return { entries };
  }

  private toFile(entry: StoredLibraryAttachment): ConversationMediaFile {
    const now = this.now();
    const attachment = toConversationAttachment(entry.attachment);
    // A file whose time ran out before the next run of the expiry is shown as gone already.
    const isExpired =
      isConversationAttachmentExpired(entry.attachment, now) &&
      attachment.expiredAt === undefined;
    return {
      tab: conversationMediaTab(attachment),
      attachment: isExpired
        ? { ...attachment, expiredAt: now.toISOString() }
        : attachment,
      messageId: entry.messageId,
      senderId: entry.senderId,
      sentAt: entry.sentAt,
    };
  }

  private async linksOf(
    messages: readonly StoredLinkedMessage[],
  ): Promise<ConversationMediaLink[]> {
    const found = messages.map((message) => ({
      message,
      links: findMessageLinks(message.text),
    }));
    const urls = [
      ...new Set(found.flatMap((entry) => entry.links.map((link) => link.url))),
    ];
    if (urls.length === 0) return [];
    // Only stored preview data: the overview never fetches a linked page.
    const previews = await this.dependencies.previews.find(urls);
    return found.flatMap(({ message, links }) =>
      links.map((link) => {
        const preview = previews.get(link.url);
        return {
          url: link.url,
          domain: hostOf(link.url),
          title:
            preview?.title !== undefined &&
            preview.title !== null &&
            preview.title !== ""
              ? preview.title
              : link.label,
          imageUrl: preview?.image ? conversationLinkImageUrl(link.url) : null,
          messageId: message.messageId,
          senderId: message.senderId,
          sentAt: message.sentAt,
        };
      }),
    );
  }

  private async requireMember(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const record = await this.dependencies.conversations.findForMember(
      conversationId,
      userId,
    );
    if (!record) throw new ConversationError("not_found");
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}

/** The people and agents who sent files or links, each once, by name. */
function sendersOf(
  entries: readonly { readonly senderId: string }[],
  accounts: MediaAccounts,
): ConversationMediaSender[] {
  const ids = [...new Set(entries.map((entry) => entry.senderId))];
  return ids
    .map((id) => {
      const participant = accounts.participant(id);
      return { id, name: participant.name, kind: participant.kind };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
