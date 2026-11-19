import { createHash, randomUUID } from "node:crypto";

import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import {
  CONVERSATION_AGENT_FILE_LIFETIME_MILLISECONDS,
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_THUMBNAIL_MAXIMUM_BYTES,
  CONVERSATION_THUMBNAIL_MIME_TYPES,
  conversationAttachmentKind,
  conversationAttachmentNameSchema,
} from "@/definition/ConversationContent";
import { CONVERSATION_MODEL_MIME_TYPE } from "@/definition/ConversationInteractiveContent";

import {
  conversationDocumentFactsOf,
  readConversationDocumentFacts,
} from "./ConversationDocumentFacts";
import {
  conversationMediaFactsOf,
  readConversationMediaFacts,
} from "./ConversationMediaFacts";
import { inspectModelStream } from "./ConversationModelFiles";

import type { ReadStream } from "node:fs";
import type {
  ConversationAttachmentRepository,
  StoredConversationAttachment,
} from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationWebPackageRepository } from "@/backend/database/repositories/conversation/ConversationWebPackageRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  ConversationAttachment,
  ConversationImage,
} from "@/definition/ConversationContent";
import type { User } from "@/definition/User";
import type { ConversationArchiveEntry } from "./ConversationZipArchive";
import type { ConversationDocumentFactsInput } from "./ConversationDocumentFacts";
import type { ConversationMediaFactsInput } from "./ConversationMediaFacts";

/**
 * What the browser read of a file: resolution and length
 * of a video or a sound, page count and title of a PDF.
 */
export type ConversationFileFactsInput = ConversationMediaFactsInput &
  ConversationDocumentFactsInput;

/** Uploads that no message took are removed after a day. */
const UNBOUND_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
/** Files younger than this are never swept, so running uploads stay. */
const SWEEP_GRACE_MILLISECONDS = 60 * 60 * 1000;
const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;
const MIME_TYPE = /^[\w.+-]{1,100}\/[\w.+-]{1,100}$/u;
const FALLBACK_MIME_TYPE = "application/octet-stream";
/**
 * How long before its moment the regular expiry removes a file:
 * one interval of {@link ConversationAttachmentExpiry}, so no file outlives
 * its 72 hours while the next run is still waiting.
 */
export const CONVERSATION_EXPIRY_LEAD_MILLISECONDS = 5 * 60 * 1000;

/** What the attachments of conversations use. */
export interface ConversationAttachmentsDependencies {
  readonly attachments: ConversationAttachmentRepository;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly files: Pick<WikiFileStore, "write" | "open" | "remove" | "sweep">;
  /** The names of the senders of images, for the image viewer. */
  readonly directory?: {
    read(): Promise<{ participant(id: string): { readonly name: string } }>;
  };
  /**
   * The files of web export packages, which go with their manifest
   * attachment; absent when no package is ever stored.
   */
  readonly packageFiles?: Pick<
    ConversationWebPackageRepository,
    "storageNamesOf" | "storageNames" | "removeExpired"
  >;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** The preview image an agent's file brings along, such as the PNG of a model. */
export interface StagedThumbnail {
  readonly mimeType: string;
  readonly source: AsyncIterable<Uint8Array>;
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
  const isExpired = Boolean(stored.expiredAt);
  return {
    id: stored.id,
    name: stored.name,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    kind: conversationAttachmentKind(stored.mimeType),
    url,
    ...(stored.thumbnail && !isExpired
      ? { thumbnailUrl: `${url}/thumbnail` }
      : {}),
    createdAt: stored.createdAt,
    ...(stored.expiresAt ? { expiresAt: stored.expiresAt } : {}),
    ...(stored.expiredAt ? { expiredAt: stored.expiredAt } : {}),
    ...conversationMediaFactsOf(stored.media),
    ...conversationDocumentFactsOf(stored.document),
    ...(stored.sha256 ? { sha256: stored.sha256 } : {}),
  };
}

/**
 * Passes the chunks of an upload on and feeds them into a SHA-256 on the way,
 * so the checksum costs no second read of the file.
 */
async function* hashedChunks(
  source: AsyncIterable<Uint8Array>,
  hash: ReturnType<typeof createHash>,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    hash.update(chunk);
    yield chunk;
  }
}

/**
 * Whether the file of an attachment is gone or its time ran out.
 *
 * @param stored - The stored attachment.
 * @param now - The moment of the request.
 */
export function isConversationAttachmentExpired(
  stored: Pick<StoredConversationAttachment, "expiresAt" | "expiredAt">,
  now: Date,
): boolean {
  if (stored.expiredAt) return true;
  return (
    Boolean(stored.expiresAt) && String(stored.expiresAt) <= now.toISOString()
  );
}

/** Reads a declared MIME type; anything unusual counts as plain bytes. */
export function readAttachmentMimeType(input: string): string {
  const type = input.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPE.test(type) ? type : FALLBACK_MIME_TYPE;
}

/** The declared type of an upload; a `.glb` file is a model to check, whatever the browser named. */
function uploadMimeType(name: string, declared: string): string {
  return name.toLowerCase().endsWith(".glb")
    ? CONVERSATION_MODEL_MIME_TYPE
    : readAttachmentMimeType(declared);
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
 * The attachments of conversation messages.
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
      mimeType: uploadMimeType(name.data, upload.mimeType),
    });
    return toConversationAttachment(stored);
  }

  /**
   * Stores a file an agent's answer attaches, before the answer is stored.
   * It stays without a message until
   * {@link ConversationAttachments.bind} takes it; {@link ConversationAttachments.sweep}
   * removes it after a day otherwise. Pages keeps it at most 72 hours from
   * now: {@link ConversationAttachments.expire} removes it then.
   *
   * @param target - The conversation and the agent that sends the answer.
   * @param file - Name, type and bytes of the file, and the preview image it
   * brings along; a preview image that cannot be stored leaves the file
   * without one.
   * @throws {ConversationError} `too_large` beyond 512 MB.
   */
  public async stage(
    target: { readonly conversationId: string; readonly senderId: string },
    file: {
      readonly name: string;
      readonly mimeType: string;
      readonly source: AsyncIterable<Uint8Array>;
      readonly thumbnail?: StagedThumbnail;
    },
  ): Promise<StoredConversationAttachment> {
    const now = this.now().getTime();
    const stored = await this.store(file.source, {
      conversationId: target.conversationId,
      messageId: null,
      uploaderId: target.senderId,
      name: file.name,
      mimeType: file.mimeType,
      expiresAt: new Date(
        now + CONVERSATION_AGENT_FILE_LIFETIME_MILLISECONDS,
      ).toISOString(),
    });
    return file.thumbnail
      ? this.storeStagedThumbnail(stored, file.thumbnail)
      : stored;
  }

  /** Drops staged files of a sender that no message took; bound ones stay. */
  public async release(
    senderId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    for (const attachmentId of attachmentIds) {
      const packageNames = await this.packageNamesOf([attachmentId]);
      const removed = await this.dependencies.attachments.removeUnbound(
        attachmentId,
        senderId,
      );
      if (removed) await this.removeFiles([removed], packageNames);
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
    thumbnail: {
      readonly attachmentId: unknown;
      readonly mimeType: string;
      /**
       * Resolution and length the browser read while it made the image,
       * page count and title of a PDF.
       */
      readonly facts?: ConversationFileFactsInput;
    },
    source: AsyncIterable<Uint8Array>,
  ): Promise<ConversationAttachment> {
    const attachment = await this.requireVisible(
      person,
      thumbnail.attachmentId,
    );
    if (thumbnail.facts)
      await this.storeMediaFacts(attachment, thumbnail.facts);
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

  /**
   * Stores the resolution and length the browser read of a video or a sound,
   * or page count and title of a PDF, once per
   * attachment; the chat shows them before the original loads.
   *
   * @throws {ConversationError} `not_found` for an attachment of a
   * conversation of which the person is no member, `invalid` for an
   * attachment that is no video, sound or PDF or facts without a usable value.
   */
  public async recordMediaFacts(
    person: User,
    attachmentId: unknown,
    facts: ConversationFileFactsInput,
  ): Promise<ConversationAttachment> {
    const attachment = await this.requireVisible(person, attachmentId);
    if (!(await this.storeMediaFacts(attachment, facts)))
      throw new ConversationError("invalid");
    const current = await this.dependencies.attachments.find(attachment.id);
    return toConversationAttachment(current ?? attachment);
  }

  /** Drops an own upload that no message took; anything else stays untouched. */
  public async discard(person: User, attachmentId: unknown): Promise<void> {
    if (typeof attachmentId !== "string" || !IDENTIFIER.test(attachmentId))
      return;
    const packageNames = await this.packageNamesOf([attachmentId]);
    const removed = await this.dependencies.attachments.removeUnbound(
      attachmentId,
      person.id,
    );
    if (removed) await this.removeFiles([removed], packageNames);
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
    const packageNames = await this.packageNamesOf(
      attachments.map((attachment) => attachment.id),
    );
    return () => this.removeFiles(attachments, packageNames);
  }

  /**
   * Collects the files and preview images of every attachment of a
   * conversation before it is deleted.
   *
   * @returns Removes the files once the conversation is gone.
   */
  public async collectConversation(
    conversationId: string,
  ): Promise<() => Promise<void>> {
    const attachments =
      await this.dependencies.attachments.forConversation(conversationId);
    const packageNames = await this.packageNamesOf(
      attachments.map((attachment) => attachment.id),
    );
    return () => this.removeFiles(attachments, packageNames);
  }

  /**
   * Removes uploads no message took within a day, and files no attachment
   * lists any more.
   *
   * @returns How many files were removed.
   */
  public async sweep(): Promise<number> {
    const now = this.now().getTime();
    const stale = await this.dependencies.attachments.removeUnboundBefore(
      new Date(now - UNBOUND_LIFETIME_MILLISECONDS).toISOString(),
    );
    await this.removeFiles(stale);
    const known = await this.dependencies.attachments.storageNames();
    for (const name of (await this.dependencies.packageFiles?.storageNames()) ??
      [])
      known.add(name);
    return this.dependencies.files.sweep(known, SWEEP_GRACE_MILLISECONDS);
  }

  /**
   * Removes the files and preview images of attachments whose 72 hours end
   * before the next run; the rows stay as placeholders.
   *
   * @remarks
   * The rows are marked first, so no request serves a file any more; a file
   * that cannot be removed now is no longer listed and the next
   * {@link ConversationAttachments.sweep} removes it.
   *
   * @returns How many files and preview images were removed.
   */
  public async expire(): Promise<number> {
    const now = this.now();
    const names = await this.dependencies.attachments.expireDue(
      new Date(
        now.getTime() + CONVERSATION_EXPIRY_LEAD_MILLISECONDS,
      ).toISOString(),
      now.toISOString(),
    );
    // The files of an expired package go with its manifest.
    names.push(
      ...((await this.dependencies.packageFiles?.removeExpired()) ?? []),
    );
    if (names.length > 0) await this.dependencies.files.remove(names);
    return names.length;
  }

  /**
   * The images of a conversation for a member, in the order they were sent
   * The image viewer pages through all of them.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member.
   */
  public async images(
    person: User,
    conversationId: unknown,
  ): Promise<ConversationImage[]> {
    return this.mediaOf(person, conversationId, "image");
  }

  /**
   * The videos of a conversation for a member, in the order they were sent
   * The split view offers the others below the open one, and the
   * full screen pages through all of them.
   *
   * @throws {ConversationError} `not_found` for a conversation of which the
   * person is no member.
   */
  public async videos(
    person: User,
    conversationId: unknown,
  ): Promise<ConversationImage[]> {
    return this.mediaOf(person, conversationId, "video");
  }

  /**
   * The files of one message that are still there, for "Alle herunterladen".
   *
   * @throws {ConversationError} `not_found` for a message without such
   * files or of a conversation of which the person is no member.
   */
  public async archive(
    person: User,
    messageId: unknown,
  ): Promise<{ readonly entries: ConversationArchiveEntry[] }> {
    const id = readIdentifier(messageId);
    const stored = await this.dependencies.attachments.forMessages([id]);
    const attachments = stored.get(id) ?? [];
    const [first] = attachments;
    if (!first) throw new ConversationError("not_found");
    await this.requireMember(person.id, first.conversationId);
    const now = this.now();
    const entries = attachments
      .filter((attachment) => !isConversationAttachmentExpired(attachment, now))
      .map((attachment) => ({
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
        open: () => this.dependencies.files.open(attachment.storageName),
      }));
    if (entries.length === 0) throw new ConversationError("not_found");
    return { entries };
  }

  /**
   * Stores usable facts of a video, a sound or a PDF that has none; `false`
   * when none are usable.
   */
  private async storeMediaFacts(
    attachment: StoredConversationAttachment,
    input: ConversationFileFactsInput,
  ): Promise<boolean> {
    const kind = conversationAttachmentKind(attachment.mimeType);
    const facts = readConversationMediaFacts(kind, input);
    if (facts !== null) {
      // Facts of another viewer that came first stay.
      if (!attachment.media)
        await this.dependencies.attachments.setMediaFacts(attachment.id, facts);
      return true;
    }
    const document = readConversationDocumentFacts(kind, input);
    if (document === null) return false;
    if (!attachment.document)
      await this.dependencies.attachments.setDocumentFacts(
        attachment.id,
        document,
      );
    return true;
  }

  private async mediaOf(
    person: User,
    conversationId: unknown,
    kind: "image" | "video",
  ): Promise<ConversationImage[]> {
    const id = readIdentifier(conversationId);
    await this.requireMember(person.id, id);
    const stored =
      kind === "image"
        ? await this.dependencies.attachments.imagesOfConversation(id)
        : await this.dependencies.attachments.mediaOfConversation(id, kind);
    const accounts = await this.dependencies.directory?.read();
    const now = this.now();
    return stored.map((image) => {
      const attachment = toConversationAttachment(image.attachment);
      return {
        attachment:
          isConversationAttachmentExpired(image.attachment, now) &&
          !attachment.expiredAt
            ? { ...attachment, expiredAt: now.toISOString() }
            : attachment,
        messageId: image.messageId,
        senderId: image.senderId,
        senderName: accounts?.participant(image.senderId).name ?? "",
        sentAt: image.sentAt,
      };
    });
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
      readonly expiresAt?: string;
    },
  ): Promise<StoredConversationAttachment> {
    const hash = createHash("sha256");
    const file = await this.write(
      hashedChunks(source, hash),
      CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
    );
    const stored: StoredConversationAttachment = {
      ...attachment,
      mimeType: await this.checkedMimeType(attachment.mimeType, file),
      sha256: hash.digest("hex"),
      id: this.dependencies.createId?.() ?? randomUUID(),
      sizeBytes: file.size,
      storageName: file.storageName,
      position: attachment.position ?? 0,
      thumbnail: null,
      createdAt: this.now().toISOString(),
      expiresAt: attachment.expiresAt ?? null,
      expiredAt: null,
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
    packageNames: readonly string[] = [],
  ): Promise<void> {
    await this.dependencies.files.remove([
      ...attachments.flatMap((attachment) => [
        attachment.storageName,
        ...(attachment.thumbnail ? [attachment.thumbnail.storageName] : []),
      ]),
      ...packageNames,
    ]);
  }

  /** The files of the packages of attachments, read before their rows go. */
  private async packageNamesOf(
    attachmentIds: readonly string[],
  ): Promise<string[]> {
    return (
      (await this.dependencies.packageFiles?.storageNamesOf(attachmentIds)) ??
      []
    );
  }

  /**
   * The stored type of a file: a model the viewer cannot show safely, being
   * broken, too large or referring to other files, is stored as plain bytes.
   */
  private async checkedMimeType(
    mimeType: string,
    file: { readonly storageName: string },
  ): Promise<string> {
    if (mimeType !== CONVERSATION_MODEL_MIME_TYPE) return mimeType;
    const inspection = await inspectModelStream(
      this.dependencies.files.open(file.storageName),
    );
    return inspection.isValid ? mimeType : FALLBACK_MIME_TYPE;
  }

  /** Stores the preview image a staged file brought along; without it the file stays as it is. */
  private async storeStagedThumbnail(
    attachment: StoredConversationAttachment,
    thumbnail: StagedThumbnail,
  ): Promise<StoredConversationAttachment> {
    const mimeType = readAttachmentMimeType(thumbnail.mimeType);
    if (!CONVERSATION_THUMBNAIL_MIME_TYPES.some((type) => type === mimeType))
      return attachment;
    try {
      const file = await this.write(
        thumbnail.source,
        CONVERSATION_THUMBNAIL_MAXIMUM_BYTES,
      );
      const isStored = await this.dependencies.attachments.setThumbnail(
        attachment.id,
        { storageName: file.storageName, mimeType, sizeBytes: file.size },
      );
      if (!isStored) await this.dependencies.files.remove([file.storageName]);
    } catch (error: unknown) {
      logCaughtError("ConversationAttachments", error);
      return attachment;
    }
    return (
      (await this.dependencies.attachments.find(attachment.id)) ?? attachment
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
    // A file whose time ran out is gone for everybody, even before the next run of the expiry.
    if (isConversationAttachmentExpired(attachment, this.now()))
      throw new ConversationError("not_found");
    return attachment;
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
