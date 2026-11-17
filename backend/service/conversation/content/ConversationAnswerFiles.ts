import { Readable } from "node:stream";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  ChatAnswerFileError,
  checkedAnswerFileName,
} from "@/backend/service/chat/ChatAnswerFileService";
import { ChatFileProbe } from "@/backend/service/chat/ChatFileProbe";
import { classifyChatFile } from "@/backend/service/chat/ChatFileTypes";
import { CHAT_ATTACHMENT_LIMIT_BYTES } from "@/definition/Chat";
import { CONVERSATION_ATTACHMENT_MAXIMUM_COUNT } from "@/definition/ConversationContent";

import type {
  ChatAnswerFileInput,
  ChatAnswerRun,
} from "@/backend/service/chat/ChatAnswerFileService";
import type { ChatFileFacts } from "@/backend/service/chat/ChatFileProbe";
import type { ChatAttachment } from "@/definition/Chat";
import type { ConversationAttachments } from "./ConversationAttachments";
import type { ConversationGeneratedImages } from "./ConversationGeneratedImages";

const COMPONENT = "ConversationAnswerFiles";

/** What the answer files of an agent in a conversation are stored with. */
export interface ConversationAnswerFileDependencies {
  readonly attachments: Pick<ConversationAttachments, "stage" | "release">;
  /** The files that wait for the next stored answer of the agent in the conversation. */
  readonly pending: Pick<ConversationGeneratedImages, "add" | "count">;
  /** Tells whether SVG markup is free of scripts and external references. */
  readonly isSafeSvg: (markup: Buffer) => boolean;
}

/** The agent and the conversation whose answer the files belong to. */
export interface ConversationAnswerTarget {
  readonly agentId: string;
  readonly conversationId: string;
}

async function factsOf(bytes: Buffer): Promise<ChatFileFacts> {
  const probe = new ChatFileProbe();
  const chunks: Uint8Array[] = [];
  for await (const chunk of probe.observe(Readable.from([bytes])))
    chunks.push(chunk);
  return probe.facts();
}

async function* bytesOf(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield new Uint8Array(bytes);
}

/**
 * The files an agent attaches to its answer in a conversation, with
 * `chat_file_create` or as blocks of its answer.
 * @remarks
 * The answer of an agent in a conversation runs in a chat session of its own
 * that nobody reads; a file linked there never reaches the chat. This store
 * replaces the answer files of such a job: it checks a file as Pica's
 * answer files are checked (allowed extension, real type, safe SVG, size,
 * count) and stores it as an attachment of the conversation without a
 * message. When the job stores its answer, the files of the run wait for the
 * answer in the conversation, which binds them to exactly that message; an
 * answer that is stopped or fails releases them. A file of a run whose
 * answer is never stored is removed with {@link ConversationAnswerFiles.discard}.
 */
export class ConversationAnswerFiles {
  private readonly dependencies: ConversationAnswerFileDependencies;
  private readonly target: ConversationAnswerTarget;
  private readonly queue = new SerialQueue();
  /** The unclaimed files by run. */
  private readonly runs = new Map<string, ChatAttachment[]>();

  public constructor(
    dependencies: ConversationAnswerFileDependencies,
    target: ConversationAnswerTarget,
  ) {
    this.dependencies = dependencies;
    this.target = target;
  }

  /**
   * Stores a file for the answer of a run.
   * @throws {ChatAnswerFileError} For a refused name, type, size or count.
   */
  public async stage(
    run: ChatAnswerRun,
    file: ChatAnswerFileInput,
  ): Promise<ChatAttachment> {
    return this.queue.run(() => this.store(run.runId, file));
  }

  /**
   * Hands every file of a run to the answer of the agent in the conversation.
   * @returns The files the answer takes; those beyond the most attachments
   * of one message are removed. The ID of the hidden chat message is not
   * needed: the answer in the conversation binds the files.
   */
  public async claim(
    run: Omit<ChatAnswerRun, "userId">,
  ): Promise<readonly ChatAttachment[]> {
    return this.queue.run(async () => {
      const files = this.runs.get(run.runId) ?? [];
      this.runs.delete(run.runId);
      if (files.length === 0) return [];
      const beyond = new Set(
        this.dependencies.pending.add(
          this.target,
          files.map((file) => file.id),
        ),
      );
      await this.release(files.filter((file) => beyond.has(file.id)));
      return files.filter((file) => !beyond.has(file.id));
    });
  }

  /** Removes the unclaimed files of a run whose answer is not stored. */
  public async discard(run: Omit<ChatAnswerRun, "userId">): Promise<void> {
    await this.queue.run(async () => {
      const files = this.runs.get(run.runId) ?? [];
      this.runs.delete(run.runId);
      await this.release(files);
    });
  }

  /** Removes only the named unclaimed files of a run, after a refused tool call. */
  public async removeStaged(
    run: Omit<ChatAnswerRun, "userId">,
    ids: readonly string[],
  ): Promise<void> {
    await this.queue.run(async () => {
      const files = this.runs.get(run.runId) ?? [];
      const removed = files.filter((file) => ids.includes(file.id));
      this.runs.set(
        run.runId,
        files.filter((file) => !ids.includes(file.id)),
      );
      await this.release(removed);
    });
  }

  private async store(
    runId: string,
    file: ChatAnswerFileInput,
  ): Promise<ChatAttachment> {
    const fileName = checkedAnswerFileName(file);
    const staged = this.runs.get(runId) ?? [];
    const waiting = this.dependencies.pending.count(this.target);
    if (staged.length + waiting >= CONVERSATION_ATTACHMENT_MAXIMUM_COUNT)
      throw new ChatAnswerFileError("FILE_LIMIT");
    if (staged.some((entry) => entry.fileName === fileName))
      throw new ChatAnswerFileError("FILE_EXISTS");
    if (file.bytes.length > CHAT_ATTACHMENT_LIMIT_BYTES)
      throw new ChatAnswerFileError("FILE_TOO_LARGE");
    const contentType = await this.contentTypeOf(fileName, file.bytes);
    const stored = await this.dependencies.attachments.stage(
      {
        conversationId: this.target.conversationId,
        senderId: this.target.agentId,
      },
      { name: fileName, mimeType: contentType, source: bytesOf(file.bytes) },
    );
    const attachment: ChatAttachment = {
      id: stored.id,
      fileName,
      contentType,
      size: stored.sizeBytes,
      origin: "assistant",
    };
    this.runs.set(runId, [...staged, attachment]);
    return attachment;
  }

  private async contentTypeOf(
    fileName: string,
    bytes: Buffer,
  ): Promise<string> {
    try {
      return classifyChatFile(
        fileName,
        await factsOf(bytes),
        this.dependencies.isSafeSvg,
      ).contentType;
    } catch (error: unknown) {
      if (error instanceof ChatError)
        throw new ChatAnswerFileError("FILE_TYPE_NOT_ALLOWED");
      throw error;
    }
  }

  private async release(files: readonly ChatAttachment[]): Promise<void> {
    if (files.length === 0) return;
    try {
      await this.dependencies.attachments.release(
        this.target.agentId,
        files.map((file) => file.id),
      );
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
    }
  }
}
