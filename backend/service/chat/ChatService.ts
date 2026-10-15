import { readAgentObject } from "@/backend/agents/AgentPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";
import { CHAT_LIMITS, canChatSearchWeb } from "@/definition/Chat";

import { readChatModelReply } from "./ChatActionProtocol";
import { isChatTextAttachment } from "./ChatAttachmentService";
import { createChatInstructions, createChatPrompt } from "./ChatPrompt";
import {
  chatConfirmationWord,
  publicChatAttachment,
  readChatSessionId,
  requireChatActor,
} from "./ChatSessionService";
import {
  isChatConfirmationOperation,
  isChatOperation,
} from "./ChatToolCatalog";

import type { TextExecution } from "@/backend/agents/TextExecution";
import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type {
  ChatSessionRepository,
  StoredChatMessage,
} from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import type { ChatConfirmationWord, ChatReply } from "@/definition/Chat";
import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";
import type { User } from "@/definition/User";
import type { ChatAttachmentService } from "./ChatAttachmentService";
import type {
  ChatInstructionInput,
  ChatPromptAttachment,
  ChatPromptInput,
  ChatStep,
} from "./ChatPrompt";
import type { ChatContextService } from "./ChatContextService";
import type { ChatSessionService } from "./ChatSessionService";
import type { ChatSettingsService } from "./ChatSettingsService";
import type { ChatToolExecutor } from "./ChatToolExecutor";

/** Actions the agent may run for one message before it has to answer. */
export const CHAT_MAXIMUM_ACTIONS = 6;

/** Characters of one text attachment the agent receives. */
const ATTACHMENT_CHARACTERS = 30_000;

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the chat turns are built from. */
export interface ChatServiceDependencies {
  readonly sessions: Pick<ChatSessionService, "require">;
  readonly context?: Pick<ChatContextService, "history">;
  readonly messages: Pick<ChatSessionRepository, "messages" | "append">;
  readonly attachments: Pick<
    ChatAttachmentService,
    "pending" | "link" | "readText"
  >;
  readonly settings: Pick<ChatSettingsService, "instruction">;
  readonly agents: Pick<AgentProfileService, "resolve">;
  readonly execution: TextExecution;
  readonly tools: Pick<ChatToolExecutor, "run">;
  readonly requests: AssistantRequestRegistry;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  /** Today's date as `YYYY-MM-DD`; the current UTC date by default. */
  readonly today?: () => string;
}

/** One sent message after validation. */
interface ChatSendRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly text: string;
  readonly attachmentIds: unknown;
}

/** Everything one answer is built from. */
interface ChatTurn {
  readonly actor: User;
  readonly agent: ResolvedAgentAssignment;
  readonly history: readonly StoredChatMessage[];
  readonly summary?: string | null;
  readonly request: ChatSendRequest;
  readonly attachments: readonly StoredChatAttachment[];
}

interface ChatAnswer {
  readonly text: string;
  readonly temporaryPasswords: readonly ChatTemporaryPassword[];
}

function readIdentifier(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new ChatError("invalidInput");
  return input;
}

function readSendRequest(input: unknown): ChatSendRequest {
  const request = readAgentObject(input);
  if (typeof request.text !== "string") throw new ChatError("invalidInput");
  const text = request.text.trim();
  const attachmentIds = request.attachmentIds ?? [];
  if (!text && (!Array.isArray(attachmentIds) || attachmentIds.length === 0))
    throw new ChatError("emptyMessage");
  if (Array.from(text).length > CHAT_LIMITS.messageCharacters)
    throw new ChatError("messageTooLong");
  // Credentials typed into the chat are refused instead of being sent to a provider.
  if (redactAssistantCredentials(text) !== text)
    throw new ChatError("credentialsInText");
  return {
    requestId: readIdentifier(request.requestId),
    sessionId: readChatSessionId(request.sessionId),
    text,
    attachmentIds,
  };
}

/** Tells whether the person typed the confirmation word as a word of its own. */
function containsWord(text: string, word: ChatConfirmationWord): boolean {
  return new RegExp(
    `(?:^|[^\\p{L}\\p{M}\\p{N}_])${word}(?:$|[^\\p{L}\\p{M}\\p{N}_])`,
    "u",
  ).test(text);
}

function readAnswer(text: string): string {
  const answer = redactAssistantCredentials(text.trim());
  if (!answer || Array.from(answer).length > CHAT_LIMITS.answerCharacters)
    throw new TextAssistantError("invalidOutput");
  return answer;
}

/**
 * The global chat agent Pica (T6.12).
 *
 * @remarks
 * Every message resolves the chat assignment anew for the person who sends it,
 * so a running answer keeps its access and model while the next message uses
 * the current assignment (T6.1.18). The agent works in a loop of at most six
 * actions; each action runs with the rights of the person (T6.12.5). Neither
 * credentials nor server paths enter a prompt, and nothing of the conversation
 * is logged.
 */
export class ChatService {
  private readonly dependencies: ChatServiceDependencies;

  public constructor(dependencies: ChatServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Sends one message of the person and returns the answer of the agent.
   *
   * @param actor - The signed-in person.
   * @param input - Request ID, session, text and the IDs of unsent attachments.
   * @returns The session, the stored message and the answer.
   */
  public async send(actor: User, input: unknown): Promise<ChatReply> {
    requireChatActor(actor);
    const request = readSendRequest(input);
    return this.dependencies.requests.run(
      actor.id,
      request.requestId,
      (signal) => this.execute(actor, request, signal),
    );
  }

  /** Cancels a running answer of the person; others' requests stay untouched. */
  public cancel(actor: User, requestId: unknown): void {
    requireChatActor(actor);
    this.dependencies.requests.cancel(actor.id, readIdentifier(requestId));
  }

  /** Cancels running answers before the database closes. */
  public shutdown(): Promise<void> {
    return this.dependencies.requests.shutdown();
  }

  private async execute(
    actor: User,
    request: ChatSendRequest,
    signal: AbortSignal,
  ): Promise<ChatReply> {
    const { sessions, attachments, messages, agents } = this.dependencies;
    const session = await sessions.require(actor, request.sessionId);
    const sent = await attachments.pending(session.id, request.attachmentIds);
    // Access and model are resolved for the person who sends, at the start of every message.
    const agent = await agents.resolve(actor.id, "chat");
    const context = this.dependencies.context
      ? await this.dependencies.context.history(actor, session.id)
      : { messages: await messages.messages(session.id), summary: null };
    const history = context.messages;
    signal.throwIfAborted();
    const question = await messages.append(actor.id, session.id, {
      role: "user",
      content: request.text,
    });
    await attachments.link(session.id, question.id, sent);
    const completed = await this.answer(
      {
        actor,
        agent,
        history,
        summary: context.summary,
        request,
        attachments: sent,
      },
      signal,
    );
    signal.throwIfAborted();
    const answer = await messages.append(actor.id, session.id, {
      role: "assistant",
      content: completed.text,
    });
    return {
      session: await sessions.require(actor, session.id),
      question: { ...question, attachments: sent.map(publicChatAttachment) },
      answer: { ...answer, attachments: [] },
      ...(completed.temporaryPasswords.length > 0
        ? { temporaryPasswords: completed.temporaryPasswords }
        : {}),
    };
  }

  private async answer(
    turn: ChatTurn,
    signal: AbortSignal,
  ): Promise<ChatAnswer> {
    const settings = await this.dependencies.languages.findByUserId(
      turn.actor.id,
    );
    const confirmationWord = chatConfirmationWord(settings?.language);
    const canSearchWeb = canChatSearchWeb(turn.agent.connection.provider);
    const instructions = createChatInstructions({
      instruction: await this.dependencies.settings.instruction(),
      personName: turn.actor.displayName,
      confirmationWord,
      canSearchWeb,
      maximumActions: CHAT_MAXIMUM_ACTIONS,
    } satisfies ChatInstructionInput);
    const prompt: Omit<ChatPromptInput, "steps" | "isLastStep"> = {
      personName: turn.actor.displayName,
      interfaceLanguage: settings?.language ?? "de",
      today:
        this.dependencies.today?.() ?? new Date().toISOString().slice(0, 10),
      history: turn.history,
      summary: turn.summary,
      message: turn.request.text,
      attachments: await this.promptAttachments(turn.attachments),
    };
    let confirmation = containsWord(turn.request.text, confirmationWord)
      ? confirmationWord
      : null;
    let agentConfirmation = containsWord(turn.request.text, "LÖSCHEN")
      ? ("LÖSCHEN" as const)
      : null;
    const steps: ChatStep[] = [];
    const temporaryPasswords: ChatTemporaryPassword[] = [];
    for (let round = 0; round <= CHAT_MAXIMUM_ACTIONS; round += 1) {
      const output = await this.dependencies.execution.run(
        {
          agent: turn.agent,
          userId: turn.actor.id,
          instructions,
          prompt: createChatPrompt({
            ...prompt,
            steps,
            isLastStep: round === CHAT_MAXIMUM_ACTIONS,
          }),
          webSearch: canSearchWeb,
        },
        signal,
      );
      signal.throwIfAborted();
      const reply = readChatModelReply(output);
      if (reply.kind === "answer")
        return { text: readAnswer(reply.text), temporaryPasswords };
      if (round === CHAT_MAXIMUM_ACTIONS) break;
      if (reply.kind === "invalid") {
        steps.push({
          operation: "",
          parameters: {},
          outcome: { ok: false, error: "INVALID_ACTION" },
        });
        continue;
      }
      const { temporaryPassword, ...outcome } =
        await this.dependencies.tools.run(
          turn.actor.id,
          reply,
          confirmation,
          agentConfirmation,
        );
      if (temporaryPassword) temporaryPasswords.push(temporaryPassword);
      steps.push({
        operation: reply.operation,
        parameters: reply.parameters,
        outcome,
      });
      // One typed confirmation allows one deletion or administration mutation.
      if (
        isChatOperation(reply.operation) &&
        isChatConfirmationOperation(reply.operation)
      ) {
        confirmation = null;
        agentConfirmation = null;
      }
    }
    throw new ChatError("stepLimit");
  }

  private async promptAttachments(
    attachments: readonly StoredChatAttachment[],
  ): Promise<readonly ChatPromptAttachment[]> {
    const described: ChatPromptAttachment[] = [];
    for (const attachment of attachments)
      described.push({
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        text: isChatTextAttachment(attachment.contentType)
          ? await this.dependencies.attachments.readText(
              attachment,
              ATTACHMENT_CHARACTERS,
            )
          : null,
      });
    return described;
  }
}
