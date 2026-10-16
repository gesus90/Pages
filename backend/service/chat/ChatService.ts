import { readAgentObject } from "@/backend/agents/AgentPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";
import { isApiProvider } from "@/definition/AgentConnection";
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
import type {
  ChatConfirmationWord,
  ChatReply,
  ChatSendResult,
} from "@/definition/Chat";
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
import type { PicaInstructions } from "./PicaInstructionFiles";
import type { PicaApiService } from "./PicaApiService";
import type { PicaAcpService } from "./acp/PicaAcpService";
import type { PicaTurnBrief } from "./acp/PicaAcpContent";

/** Actions the agent may run for one message before it has to answer. */
export const CHAT_MAXIMUM_ACTIONS = 6;

/** Characters of one text attachment the agent receives. */
export const CHAT_ATTACHMENT_CHARACTERS = 30_000;

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the chat turns are built from. */
interface ChatDependencies {
  readonly sessions: Pick<ChatSessionService, "require">;
  readonly context?: Pick<ChatContextService, "history">;
  readonly messages: Pick<
    ChatSessionRepository,
    "messages" | "append" | "findByClientId"
  >;
  readonly attachments: Pick<
    ChatAttachmentService,
    "pending" | "link" | "readText"
  >;
  readonly settings: Pick<ChatSettingsService, "instruction">;
  /**
   * Loads Pica's protected `SOUL.md` and `AGENTS.md` for every message; a
   * failure ends the message before anything is stored or sent to a model.
   */
  readonly protectedInstructions: () => Promise<PicaInstructions>;
  readonly agents: Pick<AgentProfileService, "resolve">;
  readonly requests: AssistantRequestRegistry;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  /** Today's date as `YYYY-MM-DD`; the current UTC date by default. */
  readonly today?: () => string;
}

/** Explicit composition switch: production selects native API; legacy never runs as a fallback. */
export type ChatServiceDependencies = ChatDependencies &
  (
    | {
        readonly mode: "native-api";
        readonly api: Pick<PicaApiService, "run">;
        /** Codex CLI agents over ACP (PAGE-68); without it only API agents answer. */
        readonly acp?: Pick<PicaAcpService, "steer" | "start" | "outcome">;
      }
    | {
        readonly mode: "legacy-actions";
        readonly execution: TextExecution;
        readonly tools: Pick<ChatToolExecutor, "run">;
      }
  );

/** One sent message after validation. */
interface ChatSendRequest {
  readonly requestId: string;
  /**
   * The ID the browser gave the message; it stays the same when the browser
   * sends the message again, so the server stores it once (PAGE-68).
   */
  readonly clientMessageId: string | null;
  readonly sessionId: string;
  readonly text: string;
  readonly attachmentIds: unknown;
}

/** Everything one answer is built from. */
interface ChatTurn {
  readonly actor: User;
  readonly agent: ResolvedAgentAssignment;
  readonly protectedInstructions: PicaInstructions;
  readonly history: readonly StoredChatMessage[];
  readonly summary?: string | null;
  readonly request: ChatSendRequest;
  readonly attachments: readonly StoredChatAttachment[];
}

interface ChatAnswer {
  readonly text: string;
  readonly temporaryPasswords: readonly ChatTemporaryPassword[];
}

/** What every prompt of one message is built from, before its attachments. */
interface ChatBrief extends PicaTurnBrief {
  readonly confirmationWord: ChatConfirmationWord;
  readonly canSearchWeb: boolean;
}

/** The conversation a brief describes. */
interface ChatBriefInput {
  readonly actor: User;
  readonly agent: ResolvedAgentAssignment;
  readonly protectedInstructions: PicaInstructions;
  readonly history: readonly StoredChatMessage[];
  readonly summary?: string | null;
}

interface LegacyAnswerInput {
  readonly turn: ChatTurn;
  readonly prompt: Omit<ChatPromptInput, "steps" | "isLastStep">;
  readonly instructions: string;
  readonly confirmationWord: ChatConfirmationWord;
  readonly canSearchWeb: boolean;
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
    clientMessageId:
      request.clientMessageId === undefined
        ? null
        : readIdentifier(request.clientMessageId),
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
 * the current assignment (T6.1.18). Every message also reads Pica's protected
 * `SOUL.md` and `AGENTS.md` anew (PAGE-51). Production uses the shared native
 * API runtime; the explicitly selected legacy mode retains the text loop.
 * Both modes limit actions and use the person's current rights (T6.12.5).
 * Neither credentials nor server paths enter a prompt, and nothing of the
 * conversation is logged.
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

  /**
   * Sends one message on the path its agent requires (PAGE-68).
   *
   * @param actor - The signed-in person.
   * @param input - Request ID, client message ID, session, text and the IDs of
   * unsent attachments.
   * @returns The answer of an API agent; for a Codex CLI agent the started job,
   * which runs on without the browser; while such a job runs, the steer that
   * joins it.
   * @throws {ChatError} `acpProviderUnsupported` for an agent that is neither an
   * API connection nor Codex CLI; there is no fallback to another path.
   * @throws {ChatError} `messageAlreadySent` for a message sent again whose
   * first sending took neither a job nor a steer.
   *
   * @remarks
   * A message the browser sends again with the same client message ID is not
   * stored twice; the job or steer it became is returned instead.
   */
  public async submit(actor: User, input: unknown): Promise<ChatSendResult> {
    requireChatActor(actor);
    const request = readSendRequest(input);
    const repeated = await this.repeated(actor, request);
    if (repeated) return repeated;
    const acp =
      this.dependencies.mode === "native-api" ? this.dependencies.acp : null;
    if (!acp) return { kind: "reply", reply: await this.send(actor, input) };
    // A running job takes the message first; its agent stays pinned for its turns.
    const steer = await acp.steer(actor, request);
    if (steer) return { kind: "steer", steer };
    const agent = await this.dependencies.agents.resolve(actor.id, "chat");
    if (isApiProvider(agent.connection.provider))
      return { kind: "reply", reply: await this.send(actor, input) };
    if (agent.connection.provider !== "codex_cli")
      throw new ChatError("acpProviderUnsupported");
    return {
      kind: "job",
      job: await acp.start({
        actor,
        request,
        agent,
        brief: await this.acpBrief(actor, agent, request.sessionId),
      }),
    };
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

  /**
   * The outcome of a message the browser sent before with the same client
   * message ID, or `null` when none of the conversation carries the ID.
   */
  private async repeated(
    actor: User,
    request: ChatSendRequest,
  ): Promise<ChatSendResult | null> {
    if (request.clientMessageId === null) return null;
    const { sessions, messages } = this.dependencies;
    const session = await sessions.require(actor, request.sessionId);
    const stored = await messages.findByClientId(
      session.id,
      request.clientMessageId,
    );
    if (stored === null) return null;
    const acp =
      this.dependencies.mode === "native-api" ? this.dependencies.acp : null;
    const outcome = await acp?.outcome(actor.id, session.id, stored.id);
    if (outcome) return outcome;
    throw new ChatError("messageAlreadySent");
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
    if (
      this.dependencies.mode === "native-api" &&
      !isApiProvider(agent.connection.provider)
    )
      throw new ChatError("apiModeRequired");
    const protectedInstructions =
      await this.dependencies.protectedInstructions();
    const context = this.dependencies.context
      ? await this.dependencies.context.history(actor, session.id)
      : { messages: await messages.messages(session.id), summary: null };
    const history = context.messages;
    signal.throwIfAborted();
    const question = await messages.append(actor.id, session.id, {
      role: "user",
      content: request.text,
      clientMessageId: request.clientMessageId,
    });
    await attachments.link(session.id, question.id, sent);
    const completed = await this.answer(
      {
        actor,
        agent,
        protectedInstructions,
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
    const brief = await this.brief(turn);
    const { instructions, confirmationWord, canSearchWeb } = brief;
    const prompt: Omit<ChatPromptInput, "steps" | "isLastStep"> = {
      ...brief.prompt,
      message: turn.request.text,
      attachments: await this.promptAttachments(turn.attachments),
    };
    if (this.dependencies.mode === "native-api") {
      const output = await this.dependencies.api.run(
        {
          actor: turn.actor,
          userId: turn.actor.id,
          sessionId: turn.request.sessionId,
          agent: turn.agent,
          instructions,
          prompt: createChatPrompt({ ...prompt, steps: [], isLastStep: false }),
          webSearch: false,
        },
        signal,
      );
      signal.throwIfAborted();
      return { text: readAnswer(output), temporaryPasswords: [] };
    }
    return this.legacyAnswer(
      { turn, prompt, instructions, confirmationWord, canSearchWeb },
      signal,
    );
  }

  /** Instructions and conversation context of one message, as every path builds them. */
  private async brief(input: ChatBriefInput): Promise<ChatBrief> {
    const settings = await this.dependencies.languages.findByUserId(
      input.actor.id,
    );
    const confirmationWord = chatConfirmationWord(settings?.language);
    const isNative = this.dependencies.mode === "native-api";
    const canSearchWeb =
      !isNative && canChatSearchWeb(input.agent.connection.provider);
    const instructions = createChatInstructions({
      protectedInstructions: input.protectedInstructions,
      supplement: await this.dependencies.settings.instruction(),
      personName: input.actor.displayName,
      confirmationWord,
      canSearchWeb,
      maximumActions: CHAT_MAXIMUM_ACTIONS,
      nativeTools: isNative,
    } satisfies ChatInstructionInput);
    return {
      instructions,
      confirmationWord,
      canSearchWeb,
      prompt: {
        personName: input.actor.displayName,
        interfaceLanguage: settings?.language ?? "de",
        today:
          this.dependencies.today?.() ?? new Date().toISOString().slice(0, 10),
        history: input.history,
        summary: input.summary,
        nativeTools: isNative,
      },
    };
  }

  /** The brief of a Codex job: Pica's protected files, read anew, and the transcript. */
  private async acpBrief(
    actor: User,
    agent: ResolvedAgentAssignment,
    sessionId: string,
  ): Promise<PicaTurnBrief> {
    const { sessions, messages } = this.dependencies;
    const session = await sessions.require(actor, sessionId);
    const protectedInstructions =
      await this.dependencies.protectedInstructions();
    const context = this.dependencies.context
      ? await this.dependencies.context.history(actor, session.id)
      : { messages: await messages.messages(session.id), summary: null };
    const brief = await this.brief({
      actor,
      agent,
      protectedInstructions,
      history: context.messages,
      summary: context.summary,
    });
    return { instructions: brief.instructions, prompt: brief.prompt };
  }

  private async legacyAnswer(
    input: LegacyAnswerInput,
    signal: AbortSignal,
  ): Promise<ChatAnswer> {
    if (this.dependencies.mode !== "legacy-actions")
      throw new ChatError("invalidInput");
    const { turn, prompt, instructions, confirmationWord, canSearchWeb } =
      input;
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
              CHAT_ATTACHMENT_CHARACTERS,
            )
          : null,
      });
    return described;
  }
}
