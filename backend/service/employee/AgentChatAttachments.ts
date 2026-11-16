import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ChatError } from "@/backend/error/ChatErrors";
import { conversationAttachmentKind } from "@/definition/ConversationContent";

import { IDENTIFIER } from "./AgentEmployeeSessionTypes";

import type {
  ChatAttachmentRepository,
  StoredChatAttachment,
} from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type {
  ChatAttachmentService,
  OpenedChatAttachment,
} from "@/backend/service/chat/ChatAttachmentService";
import type { ConversationArchiveEntry } from "@/backend/service/conversation/content/ConversationZipArchive";
import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";
import type { ChatAttachment } from "@/definition/Chat";
import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { User } from "@/definition/User";
import type { VirtualChatMessage } from "@/definition/VirtualChat";

/** What the files of the direct chats with agents are built from. */
export interface AgentChatAttachmentDependencies {
  readonly users: Pick<UserRepository, "findById">;
  readonly store: Pick<EmployeeStore, "conversations">;
  readonly files: Pick<ChatAttachmentService, "upload" | "discard" | "open">;
  readonly records: Pick<ChatAttachmentRepository, "list">;
  /** An unused ID for a new chat session. */
  readonly createSessionId: () => string;
}

/** The address a person reads a file of their chat with an agent from. */
function agentFileAddress(agentId: string, attachmentId: string): string {
  return `/chat/agent-files/${agentId}/${attachmentId}`;
}

/** The address of the ZIP archive of the files one message of the chat carries. */
function agentArchiveAddress(agentId: string, messageId: string): string {
  return `/chat/agent-files/${agentId}/messages/${messageId}/files.zip`;
}

function toView(
  agentId: string,
  attachment: StoredChatAttachment,
): ConversationAttachment {
  const kind = conversationAttachmentKind(attachment.contentType);
  const url = agentFileAddress(agentId, attachment.id);
  return {
    id: attachment.id,
    name: attachment.fileName,
    mimeType: attachment.contentType,
    sizeBytes: attachment.size,
    kind,
    url,
    // The original is the preview: a chat session keeps no separate preview image.
    ...(kind === "image" ? { thumbnailUrl: url } : {}),
  };
}

/**
 * The files a person sends in the direct chat with an agent.
 *
 * @remarks
 * The direct chat of an agent is its chat session, which belongs to the
 * agent's account, so a file is stored there as a session attachment with
 * the rules of every chat session: the same types, the same limits and the
 * same hand-over to the agent's prompt. The session is never named by the
 * request: it follows from the agent and the signed-in person, so a person
 * reaches only the files of their own chat with that agent.
 */
export class AgentChatAttachments {
  private readonly dependencies: AgentChatAttachmentDependencies;

  public constructor(dependencies: AgentChatAttachmentDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Stores a file for the next message of the person to the agent.
   *
   * @param person - The signed-in person.
   * @param agentId - The agent, as the request names it.
   * @param file - The streamed file.
   * @returns The stored attachment, whose ID the message names.
   * @throws {AgentEmployeeError} `notFound` for an unknown agent, `inactive`.
   * @throws {ChatError} `fileTooLarge`, `fileEmpty`, `fileNameTooLong`,
   * `fileTypeNotAllowed` or `tooManyAttachments`: the rules of a chat session.
   */
  public async upload(
    person: User,
    agentId: unknown,
    file: UploadedFile,
  ): Promise<ChatAttachment> {
    const agent = await this.requireAgent(agentId);
    const conversation = await this.dependencies.store
      .conversations()
      .ensure(
        { agentId: agent.id, personId: person.id, purpose: "chat" },
        this.dependencies.createSessionId(),
      );
    return this.dependencies.files.upload(agent, conversation.sessionId, file);
  }

  /**
   * Removes a file no message took.
   *
   * @throws {ChatError} `attachmentMissing` for a sent, unknown or foreign file.
   */
  public async discard(
    person: User,
    agentId: unknown,
    attachmentId: unknown,
  ): Promise<void> {
    const { agent, attachment } = await this.ownUpload(
      person,
      agentId,
      attachmentId,
    );
    if (attachment.messageId !== null) throw new ChatError("attachmentMissing");
    await this.dependencies.files.discard(agent, attachment.id);
  }

  /**
   * Opens a file of the person's own chat with the agent.
   *
   * @throws {ChatError} `attachmentMissing` for an unknown or foreign file.
   */
  public async open(
    person: User,
    agentId: unknown,
    attachmentId: unknown,
  ): Promise<OpenedChatAttachment> {
    const { agent, attachment } = await this.ownUpload(
      person,
      agentId,
      attachmentId,
    );
    return this.dependencies.files.open(agent, attachment.id);
  }

  /**
   * The files of one sent message of the person's own chat with the agent,
   * for "Alle herunterladen".
   *
   * @throws {ChatError} `attachmentMissing` for a message of this chat that
   * carries no file, and for any other message.
   */
  public async archive(
    person: User,
    agentId: unknown,
    messageId: unknown,
  ): Promise<{ readonly entries: ConversationArchiveEntry[] }> {
    const agent = await this.requireAgent(agentId);
    const conversation = await this.dependencies.store
      .conversations()
      .find(agent.id, person.id, "chat");
    if (!conversation || typeof messageId !== "string")
      throw new ChatError("attachmentMissing");
    const sent = (
      await this.dependencies.records.list(conversation.sessionId)
    ).filter(
      (attachment) =>
        attachment.messageId === messageId && attachment.origin !== "assistant",
    );
    if (sent.length === 0) throw new ChatError("attachmentMissing");
    return {
      entries: sent.map((attachment) => ({
        name: attachment.fileName,
        sizeBytes: attachment.size,
        open: () => this.contentOf(agent, attachment.id),
      })),
    };
  }

  /**
   * Adds the files of the sent messages of a chat session to the messages
   * they went with, as the chat shows them.
   *
   * @param agentId - The agent whose session it is.
   * @param sessionId - The session of the person's direct chat.
   * @param messages - The messages of the chat.
   * @returns The messages; those with files carry them and the address of
   * their archive.
   */
  public async withFiles(
    agentId: string,
    sessionId: string,
    messages: readonly VirtualChatMessage[],
  ): Promise<VirtualChatMessage[]> {
    const grouped = new Map<string, ConversationAttachment[]>();
    for (const attachment of await this.dependencies.records.list(sessionId)) {
      const { messageId } = attachment;
      if (messageId === null || attachment.origin === "assistant") continue;
      grouped.set(messageId, [
        ...(grouped.get(messageId) ?? []),
        toView(agentId, attachment),
      ]);
    }
    return messages.map((message) => {
      const attachments = grouped.get(message.id);
      if (!attachments) return message;
      return {
        ...message,
        attachments,
        archiveUrl: agentArchiveAddress(agentId, message.id),
      };
    });
  }

  /** The bytes of a file, opened when its turn in the archive comes. */
  private async *contentOf(
    agent: User,
    attachmentId: string,
  ): AsyncGenerator<Uint8Array> {
    const { stream } = await this.dependencies.files.open(agent, attachmentId);
    yield* stream;
  }

  private async requireAgent(agentId: unknown): Promise<User> {
    if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
      throw new AgentEmployeeError("invalidInput");
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true) throw new AgentEmployeeError("notFound");
    if (!agent.isActive) throw new AgentEmployeeError("inactive");
    return agent;
  }

  /** An upload of the person's own chat with the agent; anything else is missing. */
  private async ownUpload(
    person: User,
    agentId: unknown,
    attachmentId: unknown,
  ): Promise<{
    readonly agent: User;
    readonly attachment: StoredChatAttachment;
  }> {
    const agent = await this.requireAgent(agentId);
    const conversation = await this.dependencies.store
      .conversations()
      .find(agent.id, person.id, "chat");
    if (!conversation || typeof attachmentId !== "string")
      throw new ChatError("attachmentMissing");
    const attachment = (
      await this.dependencies.records.list(conversation.sessionId)
    ).find(
      (candidate) =>
        candidate.id === attachmentId && candidate.origin !== "assistant",
    );
    if (!attachment) throw new ChatError("attachmentMissing");
    return { agent, attachment };
  }
}
