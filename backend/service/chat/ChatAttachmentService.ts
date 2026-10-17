import { ChatError } from "@/backend/error/ChatErrors";
import { sanitizeFileName } from "@/backend/service/wiki/WikiFileTypes";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { CHAT_LIMITS } from "@/definition/Chat";
import { logCaughtError } from "@/backend/logging/Logger";

import { ChatFileProbe } from "./ChatFileProbe";
import { classifyChatFile } from "./ChatFileTypes";
import {
  publicChatAttachment,
  readChatSessionId,
  requireChatActor,
} from "./ChatSessionService";

import type { ReadStream } from "node:fs";
import type {
  ChatAttachmentRepository,
  StoredChatAttachment,
} from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ChatAttachment } from "@/definition/Chat";
import type { User } from "@/definition/User";
import type { ChatSettingsService } from "./ChatSettingsService";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the attachments of the chat are built from. */
export interface ChatAttachmentDependencies {
  readonly sessions: Pick<ChatSessionRepository, "find">;
  readonly attachments: ChatAttachmentRepository;
  readonly settings: Pick<ChatSettingsService, "read">;
  readonly files: Pick<WikiFileStore, "write" | "open" | "remove">;
  /** Tells whether SVG markup is free of scripts and external references. */
  readonly isSafeSvg: (markup: Buffer) => boolean;
}

/** An own attachment ready to be sent to the browser. */
export interface OpenedChatAttachment {
  readonly attachment: ChatAttachment;
  readonly stream: ReadStream;
}

function readAttachmentId(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new ChatError("invalidInput");
  return input;
}

/** Tells whether an attachment reaches the agent as text. */
export function isChatTextAttachment(contentType: string): boolean {
  return contentType.startsWith("text/") || contentType === "application/json";
}

/**
 * Stores attachments at a session (T6.12.4, T6.12.11).
 *
 * @remarks
 * The size follows the administrator limit and is enforced while the file
 * streams to the disk. The type is decided from the content; programs and
 * archives with executable content are refused. A refused file leaves nothing
 * behind. Attachments are deleted with their session.
 */
export class ChatAttachmentService {
  private readonly dependencies: ChatAttachmentDependencies;

  public constructor(dependencies: ChatAttachmentDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Stores a file for the next message of an own session.
   *
   * @throws {ChatError} `sessionMissing`, `fileNameTooLong`, `tooManyAttachments`,
   * `fileTooLarge`, `fileEmpty` or `fileTypeNotAllowed`.
   */
  public async upload(
    actor: User,
    sessionId: unknown,
    file: UploadedFile,
  ): Promise<ChatAttachment> {
    requireChatActor(actor);
    const session = await this.dependencies.sessions.find(
      actor.id,
      readChatSessionId(sessionId),
    );
    if (session === null) throw new ChatError("sessionMissing");
    const fileName = sanitizeFileName(file.fileName);
    if (Array.from(fileName).length > CHAT_LIMITS.fileNameCharacters)
      throw new ChatError("fileNameTooLong");
    const unsent = (
      await this.dependencies.attachments.list(session.id)
    ).filter((attachment) => attachment.messageId === null);
    if (unsent.length >= CHAT_LIMITS.attachmentsPerMessage)
      throw new ChatError("tooManyAttachments");
    const limit = (await this.dependencies.settings.read())
      .attachmentLimitBytes;
    if (file.contentLength !== null && file.contentLength > limit)
      throw new ChatError("fileTooLarge");
    const probe = new ChatFileProbe();
    const stored = await this.store(probe.observe(file.body), limit);
    try {
      if (stored.size === 0) throw new ChatError("fileEmpty");
      const type = classifyChatFile(
        fileName,
        probe.facts(),
        this.dependencies.isSafeSvg,
      );
      const attachment = await this.dependencies.attachments.insert(actor.id, {
        sessionId: session.id,
        fileName,
        contentType: type.contentType,
        size: stored.size,
        storageName: stored.storageName,
      });
      if (attachment === null) throw new ChatError("sessionMissing");
      return publicChatAttachment(attachment);
    } catch (error: unknown) {
      logCaughtError("ChatAttachmentService", error);

      await this.dependencies.files.remove([stored.storageName]);
      throw error;
    }
  }

  /**
   * Opens an attachment of an own session for download.
   *
   * @throws {ChatError} `attachmentMissing` for an unknown or foreign attachment.
   */
  public async open(actor: User, id: unknown): Promise<OpenedChatAttachment> {
    const attachment = await this.require(actor, id);
    return {
      attachment: publicChatAttachment(attachment),
      stream: this.dependencies.files.open(attachment.storageName),
    };
  }

  /**
   * Removes an attachment that was not sent yet.
   *
   * @throws {ChatError} `attachmentMissing` for a sent, unknown or foreign attachment.
   */
  public async discard(actor: User, id: unknown): Promise<void> {
    requireChatActor(actor);
    const storageName = await this.dependencies.attachments.removeUnsent(
      actor.id,
      readAttachmentId(id),
    );
    if (storageName === null) throw new ChatError("attachmentMissing");
    await this.dependencies.files.remove([storageName]);
  }

  /**
   * Returns the unsent attachments of a session that a message names.
   *
   * @throws {ChatError} `tooManyAttachments` or `attachmentMissing` when an ID
   * is not an unsent attachment of this session.
   */
  public async pending(
    sessionId: string,
    ids: unknown,
  ): Promise<readonly StoredChatAttachment[]> {
    if (!Array.isArray(ids)) throw new ChatError("invalidInput");
    if (ids.length > CHAT_LIMITS.attachmentsPerMessage)
      throw new ChatError("tooManyAttachments");
    const wanted = new Set(ids.map(readAttachmentId));
    const unsent = (await this.dependencies.attachments.list(sessionId)).filter(
      (attachment) =>
        attachment.messageId === null && wanted.has(attachment.id),
    );
    if (unsent.length !== wanted.size) throw new ChatError("attachmentMissing");
    return unsent;
  }

  /** Links the attachments of a sent message to it. */
  public async link(
    sessionId: string,
    messageId: string,
    attachments: readonly StoredChatAttachment[],
  ): Promise<void> {
    await this.dependencies.attachments.link(
      sessionId,
      messageId,
      attachments.map(({ id }) => id),
    );
  }

  /**
   * Reads the start of a text attachment for the agent.
   *
   * @param attachment - A text attachment of a session whose owner was checked.
   * @param maximumCharacters - How much text the agent receives at most.
   * @returns The text, cut after the given number of characters.
   */
  public async readText(
    attachment: StoredChatAttachment,
    maximumCharacters: number,
  ): Promise<string> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stream = this.dependencies.files.open(attachment.storageName);
    try {
      // A file stream without an encoding yields buffers.
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes >= maximumCharacters * 4) break;
      }
    } finally {
      stream.destroy();
    }
    return Array.from(new TextDecoder().decode(Buffer.concat(chunks)))
      .slice(0, maximumCharacters)
      .join("");
  }

  /**
   * Reads a whole attachment for the agent, such as an image.
   *
   * @param attachment - An attachment of a session whose owner was checked.
   * @param maximumBytes - The largest file the agent receives.
   * @returns The bytes, or `null` when the file is larger.
   */
  public async readBytes(
    attachment: StoredChatAttachment,
    maximumBytes: number,
  ): Promise<Buffer | null> {
    if (attachment.size > maximumBytes) return null;
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stream = this.dependencies.files.open(attachment.storageName);
    try {
      // A file stream without an encoding yields buffers.
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        bytes += chunk.length;
        if (bytes > maximumBytes) return null;
        chunks.push(chunk);
      }
    } finally {
      stream.destroy();
    }
    return Buffer.concat(chunks);
  }

  private async require(
    actor: User,
    id: unknown,
  ): Promise<StoredChatAttachment> {
    requireChatActor(actor);
    const attachment = await this.dependencies.attachments.find(
      actor.id,
      readAttachmentId(id),
    );
    if (attachment === null) throw new ChatError("attachmentMissing");
    return attachment;
  }

  private async store(
    body: AsyncIterable<Uint8Array>,
    limit: number,
  ): Promise<{ readonly storageName: string; readonly size: number }> {
    try {
      return await this.dependencies.files.write(body, {
        absoluteLimit: limit,
        limitFor: () => limit,
      });
    } catch (error: unknown) {
      logCaughtError("ChatAttachmentService", error);

      if (error instanceof FileTooLargeError)
        throw new ChatError("fileTooLarge");
      throw error;
    }
  }
}
