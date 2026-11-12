import { randomUUID } from "node:crypto";

import { ConversationError } from "@/backend/error/ConversationError";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import {
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_THUMBNAIL_MAXIMUM_BYTES,
  CONVERSATION_THUMBNAIL_MIME_TYPES,
  conversationAttachmentKind,
  conversationAttachmentNameSchema,
} from "@/definition/ConversationContent";

import type { ReadStream } from "node:fs";
import type {
  ConversationAttachmentRepository,
  StoredConversationAttachment,
} from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { User } from "@/definition/User";

/** Uploads that no message took are removed after a day. */
const UNBOUND_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
/** Files younger than this are never swept, so running uploads stay. */
const SWEEP_GRACE_MILLISECONDS = 60 * 60 * 1000;
const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;
const MIME_TYPE = /^[\w.+-]{1,100}\/[\w.+-]{1,100}$/u;
const FALLBACK_MIME_TYPE = "application/octet-stream";

/** What the attachments of conversations use. */
export interface ConversationAttachmentsDependencies {
  readonly attachments: ConversationAttachmentRepository;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly files: Pick<WikiFileStore, "write" | "open" | "remove" | "sweep">;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** The declared facts of an upload before its bytes arrive. */
export interface ConversationAttachmentUpload {
  readonly conversationId: string;
  readonly name: unknown;
  readonly mimeType: string;
}

/** The part of a file a request asks for: first and last byte, both included. */
export interface ConversationFileRange {
  readonly start: number;
  readonly end: number;
}

/** A file of an attachment, opened for one member. */
export interface OpenedConversationFile {
  readonly name: string;
  readonly mimeType: string;
  /** The size of the whole file. */
  readonly sizeBytes: number;
  /** The part the stream carries; `null` for the whole file. */
  readonly range: ConversationFileRange | null;
  readonly stream: ReadStream;
}

/** The address a client loads the original of an attachment from. */
export function conversationAttachmentUrl(attachmentId: string): string {
  return `/chat/files/${encodeURIComponent(attachmentId)}`;
}

/**
 * Turns a stored attachment into the attachment every client sees.
 *
 * @param stored - The stored attachment.
 * @returns The attachment without the names of its files.
 */
export function toConversationAttachment(
  stored: StoredConversationAttachment,
): ConversationAttachment {
  const url = conversationAttachmentUrl(stored.id);
  return {
    id: stored.id,
    name: stored.name,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    kind: conversationAttachmentKind(stored.mimeType),
    url,
    ...(stored.thumbnail ? { thumbnailUrl: `${url}/thumbnail` } : {}),
  };
}

/** Reads a declared MIME type; anything unusual counts as plain bytes. */
export function readAttachmentMimeType(input: string): string {
  const type = input.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPE.test(type) ? type : FALLBACK_MIME_TYPE;
}

function readIdentifier(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new ConversationError("not_found");
  return input;
}

/** The part of a file of `size` bytes a range asks for, or `null` for one outside it. */
function clampRange(
  range: ConversationFileRange | null,
  size: number,
): ConversationFileRange | null {
  if (range === null || size === 0) return null;
  if (range.start >= size || range.start > range.end) return null;
  return { start: range.start, end: Math.min(range.end, size - 1) };
}

/**
 * The attachments of conversation messages (PAGE-298).
 *
 * @remarks
 * A file streams into the file store of Pages, at most 512 MB, and is never
 * changed afterwards; a refused or interrupted upload leaves nothing behind.
 * Every upload and every read checks on the server that the account is a
 * member of the conversation now, so leaving a conversation ends the access;
 * a file of a conversation the account does not belong to answers
 * `not_found`, as a missing one does. Preview images come from the browser,
 * never from the server.
 */
export class ConversationAttachments {
  private readonly dependencies: ConversationAttachmentsDependencies;

  public constructor(dependencies: ConversationAttachmentsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Streams an uploaded file to the store, for a message sent afterwards.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member, `invalid` for an unusable name, `too_large` beyond
   * 512 MB.
   */
  public async upload(
    person: User,
    upload: ConversationAttachmentUpload,
    source: AsyncIterable<Uint8Array>,
  ): Promise<ConversationAttachment> {
    const name = conversationAttachmentNameSchema.safeParse(upload.name);
    if (!name.success) throw new ConversationError("invalid");
    await this.requireMember(person.id, upload.conversationId);
    const stored = await this.store(source, {
      conversationId: upload.conversationId,
      messageId: null,
      uploaderId: person.id,
      name: name.data,
      mimeType: readAttachmentMimeType(upload.mimeType),
    });
    return toConversationAttachment(stored);
  }

  /**
   * Stores a file an agent's answer attaches, before the answer is stored
   * (PAGE-298, B2). It stays without a message until
   * {@link ConversationAttachments.bind} takes it; {@link ConversationAttachments.sweep}
   * removes it after a day otherwise.
   *
   * @param target - The conversation and the agent that sends the answer.
   * @param file - Name, type and bytes of the file.
   * @throws {ConversationError} `too_large` beyond 512 MB.
   */
  public async stage(
    target: { readonly conversationId: string; readonly senderId: string },
    file: {
      readonly name: string;
      readonly mimeType: string;
      readonly source: AsyncIterable<Uint8Array>;
    },
  ): Promise<StoredConversationAttachment> {
    return this.store(file.source, {
      conversationId: target.conversationId,
      messageId: null,
      uploaderId: target.senderId,
      name: file.name,
      mimeType: file.mimeType,
    });
  }

  /** Drops staged files of a sender that no message took; bound ones stay. */
  public async release(
    senderId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    for (const attachmentId of attachmentIds) {
      const removed = await this.dependencies.attachments.removeUnbound(
        attachmentId,
        senderId,
      );
      if (removed) await this.removeFiles([removed]);
    }
  }

  /**
   * Stores the preview image the browser made of an attachment that has none.
   *
   * @throws {ConversationError} `not_found` for an attachment of a
   * conversation of which the person is no member, `unsupported_format` for
   * anything but WebP, JPEG or PNG, `too_large` beyond 1 MB.
   */
  public async uploadThumbnail(
    person: User,
    thumbnail: { readonly attachmentId: unknown; readonly mimeType: string },
    source: AsyncIterable<Uint8Array>,
  ): Promise<ConversationAttachment> {
    const attachment = await this.requireVisible(
      person,
      thumbnail.attachmentId,
    );
    const mimeType = readAttachmentMimeType(thumbnail.mimeType);
    if (!CONVERSATION_THUMBNAIL_MIME_TYPES.some((type) => type === mimeType))
      throw new ConversationError("unsupported_format");
    if (attachment.thumbnail) return toConversationAttachment(attachment);
    const file = await this.write(source, CONVERSATION_THUMBNAIL_MAXIMUM_BYTES);
    const isStored = await this.dependencies.attachments.setThumbnail(
      attachment.id,
      { storageName: file.storageName, mimeType, sizeBytes: file.size },
    );
    // Another viewer was faster; its image stays.
    if (!isStored) await this.dependencies.files.remove([file.storageName]);
    const current = await this.dependencies.attachments.find(attachment.id);
    return toConversationAttachment(current ?? attachment);
  }

  /** Drops an own upload that no message took; anything else stays untouched. */
  public async discard(person: User, attachmentId: unknown): Promise<void> {
    if (typeof attachmentId !== "string" || !IDENTIFIER.test(attachmentId))
      return;
    const removed = await this.dependencies.attachments.removeUnbound(
      attachmentId,
      person.id,
    );
    if (removed) await this.removeFiles([removed]);
  }

  /**
   * Opens the original or the preview image of an attachment for a member of
   * its conversation.
   *
   * @param person - The signed-in account.
   * @param target - The attachment, which of its files, and the byte range.
   * @throws {ConversationError} `not_found` for a missing attachment, a
   * missing preview image, or a conversation of which the person is no member.
   */
  public async open(
    person: User,
    target: {
      readonly attachmentId: unknown;
      readonly variant: "original" | "thumbnail";
      readonly range?: ConversationFileRange | null;
    },
  ): Promise<OpenedConversationFile> {
    const attachment = await this.requireVisible(person, target.attachmentId);
    if (target.variant === "thumbnail") {
      const { thumbnail } = attachment;
      if (!thumbnail) throw new ConversationError("not_found");
      return {
        name: attachment.name,
        mimeType: thumbnail.mimeType,
        sizeBytes: thumbnail.sizeBytes,
        range: null,
        stream: this.dependencies.files.open(thumbnail.storageName),
      };
    }
    const range = clampRange(target.range ?? null, attachment.sizeBytes);
    return {
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      range,
      stream: this.dependencies.files.open(
        attachment.storageName,
        range ?? undefined,
      ),
    };
  }

  /**
   * Binds uploaded attachments of the sender to a message.
   *
   * @throws {ConversationError} `invalid` when one is missing, belongs to
   * another conversation or sender, or has a message already.
   */
  public async bind(
    message: {
      readonly id: string;
      readonly conversationId: string;
      readonly senderId: string;
    },
    attachmentIds: readonly string[],
  ): Promise<void> {
    const isBound = await this.dependencies.attachments.bind(
      message,
      attachmentIds,
    );
    if (!isBound) throw new ConversationError("invalid");
  }

  /** Returns the attachments of messages as clients see them, by message ID. */
  public async forMessages(
    messageIds: readonly string[],
  ): Promise<Map<string, ConversationAttachment[]>> {
    const stored = await this.dependencies.attachments.forMessages(messageIds);
    return new Map(
      [...stored].map(([messageId, attachments]) => [
        messageId,
        attachments.map(toConversationAttachment),
      ]),
    );
  }

  /**
   * Reads the files of a message before it is deleted.
   *
   * @returns Removes those files; call it once the message is gone.
   */
  public async collect(messageId: string): Promise<() => Promise<void>> {
    const stored = await this.dependencies.attachments.forMessages([messageId]);
    const attachments = stored.get(messageId) ?? [];
    return () => this.removeFiles(attachments);
  }

  /**
   * Removes uploads no message took within a day, and files no attachment
   * lists any more.
   *
   * @returns How many files were removed.
   */
  public async sweep(): Promise<number> {
    const now = (this.dependencies.now?.() ?? new Date()).getTime();
    const stale = await this.dependencies.attachments.removeUnboundBefore(
      new Date(now - UNBOUND_LIFETIME_MILLISECONDS).toISOString(),
    );
    await this.removeFiles(stale);
    return this.dependencies.files.sweep(
      await this.dependencies.attachments.storageNames(),
      SWEEP_GRACE_MILLISECONDS,
    );
  }

  private async store(
    source: AsyncIterable<Uint8Array>,
    attachment: {
      readonly conversationId: string;
      readonly messageId: string | null;
      readonly uploaderId: string;
      readonly name: string;
      readonly mimeType: string;
      readonly position?: number;
    },
  ): Promise<StoredConversationAttachment> {
    const file = await this.write(
      source,
      CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
    );
    const stored: StoredConversationAttachment = {
      ...attachment,
      id: this.dependencies.createId?.() ?? randomUUID(),
      sizeBytes: file.size,
      storageName: file.storageName,
      position: attachment.position ?? 0,
      thumbnail: null,
      createdAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
    };
    try {
      await this.dependencies.attachments.insert(stored);
    } catch (error: unknown) {
      await this.dependencies.files.remove([file.storageName]);
      throw error;
    }
    return stored;
  }

  /** Streams bytes to the store within a limit; nothing stays of a larger file. */
  private async write(
    source: AsyncIterable<Uint8Array>,
    limit: number,
  ): Promise<Awaited<ReturnType<WikiFileStore["write"]>>> {
    try {
      return await this.dependencies.files.write(source, {
        absoluteLimit: limit,
        limitFor: () => limit,
      });
    } catch (error: unknown) {
      if (error instanceof FileTooLargeError)
        throw new ConversationError("too_large");
      throw error;
    }
  }

  private async removeFiles(
    attachments: readonly StoredConversationAttachment[],
  ): Promise<void> {
    await this.dependencies.files.remove(
      attachments.flatMap((attachment) => [
        attachment.storageName,
        ...(attachment.thumbnail ? [attachment.thumbnail.storageName] : []),
      ]),
    );
  }

  private async requireMember(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const record = IDENTIFIER.test(conversationId)
      ? await this.dependencies.conversations.findForMember(
          conversationId,
          userId,
        )
      : null;
    if (!record) throw new ConversationError("not_found");
  }

  /** The attachment, when the person is a member of its conversation now. */
  private async requireVisible(
    person: User,
    attachmentId: unknown,
  ): Promise<StoredConversationAttachment> {
    const attachment = await this.dependencies.attachments.find(
      readIdentifier(attachmentId),
    );
    if (!attachment) throw new ConversationError("not_found");
    await this.requireMember(person.id, attachment.conversationId);
    // An upload that is not sent yet is its uploader's alone.
    if (attachment.messageId === null && attachment.uploaderId !== person.id)
      throw new ConversationError("not_found");
    return attachment;
  }
}
