import { Readable } from "node:stream";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { sanitizeFileName } from "@/backend/service/wiki/WikiFileTypes";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { CHAT_LIMITS } from "@/definition/Chat";

import { ChatFileProbe } from "./ChatFileProbe";
import { classifyChatFile } from "./ChatFileTypes";
import { publicChatAttachment } from "./ChatSessionService";

import type { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ChatAttachment } from "@/definition/Chat";
import type { ChatSettingsService } from "./ChatSettingsService";

/** Why Pica could not attach a file; the codes reach the model as tool errors. */
export type ChatAnswerFileErrorCode =
  | "FILE_NAME_INVALID"
  | "FILE_TYPE_NOT_ALLOWED"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY"
  | "FILE_LIMIT"
  | "FILE_EXISTS"
  | "NOT_FOUND";

/** A file Pica could not attach to its answer. */
export class ChatAnswerFileError extends Error {
  public readonly code: ChatAnswerFileErrorCode;

  public constructor(code: ChatAnswerFileErrorCode) {
    super(code);
    this.name = "ChatAnswerFileError";
    this.code = code;
  }
}

/** What the answer files of Pica are built from. */
export interface ChatAnswerFileDependencies {
  readonly attachments: Pick<
    ChatAttachmentRepository,
    | "insertAnswerFile"
    | "answerFiles"
    | "claimAnswerFiles"
    | "removeUnclaimedAnswerFiles"
  >;
  readonly settings: Pick<ChatSettingsService, "read">;
  readonly files: Pick<WikiFileStore, "write" | "remove">;
  /** Tells whether SVG markup is free of scripts and external references. */
  readonly isSafeSvg: (markup: Buffer) => boolean;
}

/** The run a file belongs to: the person, the conversation and the server run. */
export interface ChatAnswerRun {
  readonly userId: string;
  readonly sessionId: string;
  readonly runId: string;
}

/** One file Pica attaches to the answer of its run. */
export interface ChatAnswerFileInput {
  readonly fileName: string;
  readonly bytes: Buffer;
  /** The extensions this source may write; the content must match one of them. */
  readonly extensions: ReadonlySet<string>;
}

function extensionOf(fileName: string): string {
  return /\.([a-z0-9]+)$/u.exec(fileName.toLowerCase())?.[1] ?? "";
}

/**
 * Files Pica attaches to its answer (PAGE-92).
 *
 * @remarks
 * A file comes only from the bytes the run actually produced: the text of a
 * file the Pica tool writes or an image or resource block the agent returned.
 * No model names a path, a foreign file or a URL that Pages would read. The
 * bytes pass the same type, size and safety checks as an upload, are stored
 * under a name the server picks and stay invisible until the answer of their
 * run is stored; a run without an answer leaves nothing behind.
 */
export class ChatAnswerFileService {
  private readonly dependencies: ChatAnswerFileDependencies;
  private readonly queues = new Map<string, SerialQueue>();
  /** Runs of this process that stored a file; others have nothing to link or remove. */
  private readonly runs = new Set<string>();
  private recovery: Promise<void> | null = null;

  public constructor(dependencies: ChatAnswerFileDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Stores a file for the answer of a run.
   *
   * @throws {ChatAnswerFileError} For a refused name, type, size or count.
   */
  public async stage(
    run: ChatAnswerRun,
    file: ChatAnswerFileInput,
  ): Promise<ChatAttachment> {
    await this.ready();
    const stored = await this.queue(run.runId).run(() => this.store(run, file));
    this.runs.add(run.runId);
    return stored;
  }

  /** Links every file of a run to its stored answer and returns them. */
  public async claim(
    run: Omit<ChatAnswerRun, "userId">,
    messageId: string,
  ): Promise<readonly ChatAttachment[]> {
    if (!this.runs.has(run.runId)) return [];
    const claimed = await this.dependencies.attachments.claimAnswerFiles(
      run.sessionId,
      run.runId,
      messageId,
    );
    return claimed.map(publicChatAttachment);
  }

  /** Removes the files of a run that ended without an answer that holds them. */
  public async discard(run: Omit<ChatAnswerRun, "userId">): Promise<void> {
    this.queues.delete(run.runId);
    if (!this.runs.delete(run.runId)) return;
    const files =
      await this.dependencies.attachments.removeUnclaimedAnswerFiles(
        run.sessionId,
        run.runId,
      );
    await this.dependencies.files.remove(files);
  }

  private async store(
    run: ChatAnswerRun,
    file: ChatAnswerFileInput,
  ): Promise<ChatAttachment> {
    const fileName = sanitizeFileName(file.fileName);
    // A name is never a path: a model that names folders gets a refusal, not a cleaned name.
    if (
      /[\\/]/u.test(file.fileName) ||
      !fileName ||
      Array.from(fileName).length > CHAT_LIMITS.fileNameCharacters ||
      !file.extensions.has(extensionOf(fileName))
    )
      throw new ChatAnswerFileError("FILE_NAME_INVALID");
    if (file.bytes.length === 0) throw new ChatAnswerFileError("FILE_EMPTY");
    const staged = await this.dependencies.attachments.answerFiles(
      run.sessionId,
      run.runId,
    );
    if (staged.length >= CHAT_LIMITS.filesPerAnswer)
      throw new ChatAnswerFileError("FILE_LIMIT");
    if (staged.some((entry) => entry.fileName === fileName))
      throw new ChatAnswerFileError("FILE_EXISTS");
    const limit = (await this.dependencies.settings.read())
      .attachmentLimitBytes;
    if (file.bytes.length > limit)
      throw new ChatAnswerFileError("FILE_TOO_LARGE");
    return this.write(run, fileName, file.bytes, limit);
  }

  private async write(
    run: ChatAnswerRun,
    fileName: string,
    bytes: Buffer,
    limit: number,
  ): Promise<ChatAttachment> {
    const probe = new ChatFileProbe();
    const stored = await this.dependencies.files
      .write(probe.observe(Readable.from([bytes])), {
        absoluteLimit: limit,
        limitFor: () => limit,
      })
      .catch((error: unknown) => {
        throw error instanceof FileTooLargeError
          ? new ChatAnswerFileError("FILE_TOO_LARGE")
          : error;
      });
    try {
      const type = classifyChatFile(
        fileName,
        probe.facts(),
        this.dependencies.isSafeSvg,
      );
      const inserted = await this.dependencies.attachments.insertAnswerFile(
        run.userId,
        {
          sessionId: run.sessionId,
          runId: run.runId,
          fileName,
          contentType: type.contentType,
          size: stored.size,
          storageName: stored.storageName,
        },
      );
      if (inserted === null) throw new ChatAnswerFileError("NOT_FOUND");
      return publicChatAttachment(inserted);
    } catch (error: unknown) {
      logCaughtError("ChatAnswerFileService", error);

      await this.dependencies.files.remove([stored.storageName]);
      if (error instanceof ChatAnswerFileError) throw error;
      throw new ChatAnswerFileError("FILE_TYPE_NOT_ALLOWED");
    }
  }

  private queue(runId: string): SerialQueue {
    let queue = this.queues.get(runId);
    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(runId, queue);
    }
    return queue;
  }

  /** Removes the files a previous server process left without an answer, once. */
  private ready(): Promise<void> {
    this.recovery ??= this.removeAbandoned();
    return this.recovery;
  }

  private async removeAbandoned(): Promise<void> {
    try {
      const files =
        await this.dependencies.attachments.removeUnclaimedAnswerFiles(
          null,
          null,
        );
      await this.dependencies.files.remove(files);
    } catch (error: unknown) {
      logCaughtError("ChatAnswerFileService", error);

      logDiagnostic(
        "ChatAnswerFileService",
        "error",
        "[pages] Abandoned answer files of Pica could not be removed.",
        error,
      );
    }
  }
}
