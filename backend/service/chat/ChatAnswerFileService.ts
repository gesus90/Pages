import { Readable } from "node:stream";

import { containsAgentBrowserSecret } from "@/backend/security/AgentBrowserSecrets";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError } from "@/backend/logging/Logger";
import { sanitizeFileName } from "@/backend/service/wiki/WikiFileTypes";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { CHAT_ATTACHMENT_LIMIT_BYTES, CHAT_LIMITS } from "@/definition/Chat";

import { ChatFileProbe } from "./ChatFileProbe";
import { classifyChatFile } from "./ChatFileTypes";
import { publicChatAttachment } from "./ChatSessionService";

import type {
  ChatAttachmentRepository,
  StoredChatAttachment,
} from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ChatAttachment } from "@/definition/Chat";

/** Why Pica could not attach a file; the codes reach the model as tool errors. */
export type ChatAnswerFileErrorCode =
  | "FILE_CREDENTIALS"
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
  > &
    Partial<Pick<ChatAttachmentRepository, "removeUnclaimedAnswerFile">>;
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
  private readonly queueUsers = new Map<string, number>();
  /** Runs of this process that stored a file; others have nothing to link or remove. */
  private readonly runs = new Set<string>();

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
    return this.runQueued(run.runId, async () => {
      const stored = await this.store(run, file);
      this.runs.add(run.runId);
      return stored;
    });
  }

  /** Links every file of a run to its stored answer and returns them. */
  public async claim(
    run: Omit<ChatAnswerRun, "userId">,
    messageId: string,
  ): Promise<readonly ChatAttachment[]> {
    return this.runQueued(run.runId, async () => {
      if (!this.runs.has(run.runId)) return [];
      const claimed = await this.dependencies.attachments.claimAnswerFiles(
        run.sessionId,
        run.runId,
        messageId,
      );
      return claimed.map(publicChatAttachment);
    });
  }

  /** Removes unclaimed files of a run the caller has established is no longer active. */
  public async discard(run: Omit<ChatAnswerRun, "userId">): Promise<void> {
    await this.runQueued(run.runId, async () => {
      const files = await this.dependencies.attachments.answerFiles(
        run.sessionId,
        run.runId,
      );
      for (const file of files) await this.removeStored(file);
      this.runs.delete(run.runId);
    });
  }

  /** Rolls back only the unclaimed files produced by a refused tool call. */
  public async removeStaged(
    run: Omit<ChatAnswerRun, "userId">,
    ids: readonly string[],
  ): Promise<void> {
    await this.runQueued(run.runId, async () => {
      const files = await this.dependencies.attachments.answerFiles(
        run.sessionId,
        run.runId,
      );
      for (const file of files)
        if (ids.includes(file.id)) await this.removeStored(file);
    });
  }

  private async removeStored(file: StoredChatAttachment): Promise<void> {
    const removeFile = this.dependencies.attachments.removeUnclaimedAnswerFile;
    if (!removeFile) throw new Error("Answer file rollback unavailable");
    await removeFile.call(
      this.dependencies.attachments,
      file.sessionId,
      file.runId ?? null,
      file.id,
      (storageName) => this.dependencies.files.remove([storageName]),
    );
  }

  private async store(
    run: ChatAnswerRun,
    file: ChatAnswerFileInput,
  ): Promise<ChatAttachment> {
    if (containsAgentBrowserSecret(file.bytes.toString("utf8")))
      throw new ChatAnswerFileError("FILE_CREDENTIALS");
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
    if (file.bytes.length > CHAT_ATTACHMENT_LIMIT_BYTES)
      throw new ChatAnswerFileError("FILE_TOO_LARGE");
    return this.write(run, fileName, file.bytes, CHAT_ATTACHMENT_LIMIT_BYTES);
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

  private async runQueued<T>(
    runId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const queue = this.queue(runId);
    this.queueUsers.set(runId, (this.queueUsers.get(runId) ?? 0) + 1);
    try {
      return await queue.run(task);
    } finally {
      const remaining = (this.queueUsers.get(runId) ?? 1) - 1;
      if (remaining === 0) {
        this.queueUsers.delete(runId);
        if (!this.runs.has(runId)) this.queues.delete(runId);
      } else this.queueUsers.set(runId, remaining);
    }
  }
}
