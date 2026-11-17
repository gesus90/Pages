import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { AgentImageToolDependencies } from "./AgentImageTool";
import type { AgentMediaToolDependencies } from "./AgentMediaTool";
import type { AgentAttachmentToolDependencies } from "./AgentAttachmentTool";
import type { ConversationAnswerFileDependencies } from "@/backend/service/conversation/content/ConversationAnswerFiles";
import type { ConversationAnswerStream } from "@/backend/service/conversation/ConversationAnswerStream";
import type { LiveAnswerSink } from "@/backend/service/conversation/ConversationLiveAnswer";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type { PicaAcpConversationTurn } from "@/backend/service/chat/acp/PicaAcpSteering";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentConversationPurpose } from "@/backend/database/repositories/employee/AgentConversationRepository";
import type { AgentChatModelKey } from "@/backend/database/repositories/employee/AgentChatModelRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type {
  PicaAcpEmployeeRun,
  PicaAcpService,
} from "../chat/acp/PicaAcpService";
import type { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import type { AgentChatHistoryService } from "@/backend/service/conversation/AgentChatHistoryService";
import type { AgentChatTaskService } from "./AgentChatTaskService";
import type { AgentChatTools } from "@/definition/AgentChat";
import type { User } from "@/definition/User";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { AgentMemoryService } from "./AgentMemoryService";
import type { AgentMemoryRecorder } from "./AgentMemoryRecorder";
import type { AgentChatReader } from "./AgentChatReader";
import type { AgentChatSessionLifecycle } from "./AgentChatSessionLifecycle";
import type { AgentLogbookService } from "./AgentLogbookService";
import type { AgentRecipeService } from "./AgentRecipeService";
import type {
  AgentChatToolGuard,
  AgentChatToolScope,
} from "./AgentChatToolGuard";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentHostFiles } from "./AgentHostFiles";
import type { AgentSessionSlots } from "./AgentSessionSlots";

export const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/u;

/** What the sessions of agents run on. */
export interface AgentEmployeeSessionDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly languages: Pick<UserSettingsRepository, "findByUserId">;
  readonly models: AgentEmployeeModels;
  readonly memory: AgentMemoryService;
  /** Pica's ACP path; `null` where the server runs no ACP chat. */
  readonly acp: Pick<
    PicaAcpService,
    | "start"
    | "steer"
    | "update"
    | "stop"
    | "cancelTool"
    | "journals"
    | "settled"
    | "activity"
  > | null;
  /** The limits of concurrent sessions; absent runs every session at once. */
  readonly slots?: Pick<AgentSessionSlots, "acquire">;
  /** The MCP servers of the host for YOLO; absent gives none. */
  readonly accessEnvironment?: Pick<
    AgentAccessEnvironmentService,
    "chatServers"
  >;
  /** Attaches files of the working folder with the agent's rights; absent offers no such tool. */
  readonly hostFiles?: Pick<AgentHostFiles, "attach">;
  /** Keeps `MEMORY.md` current after each answer of a direct chat; absent records nothing. */
  readonly recorder?: Pick<AgentMemoryRecorder, "record">;
  /**
   * The Pages tools to read chats and send messages. A function,
   * because the conversations are wired after the sessions; `null` where none.
   */
  readonly agentChat?: () => AgentChatTools | null;
  /**
   * The interim messages and questions of agents in their chat.
   * A function, because the conversations are wired after the sessions;
   * `null` offers neither.
   */
  readonly chatQuestions?: () => Pick<AgentChatQuestionService, "bind"> | null;
  /**
   * The scheduled tasks agents plan from their chat. A function,
   * because the automations are wired after the sessions; `null` plans none.
   */
  readonly chatTasks?: () => Pick<AgentChatTaskService, "bind"> | null;
  /**
   * The search over the earlier messages of the agents' chats;
   * absent offers no history tools.
   */
  readonly chatHistory?: Pick<AgentChatHistoryService, "bind">;
  /** An unused ID for a new chat session. */
  readonly createSessionId: () => string;
  /**
   * Reads the stored context of a group as the agent's own account;
   * offered to the agent as `read_conversation_context`.
   */
  readonly conversationContext?: {
    readForAgent(agentId: string, input: unknown): Promise<unknown>;
  };
  /**
   * What happens to a chat session after its rounds, such as the restart at
   * a full context. A function, because it is wired after the
   * sessions; `null` runs without it.
   */
  readonly lifecycle?: () => Pick<
    AgentChatSessionLifecycle,
    "restartIfNeeded" | "afterRound"
  > | null;
  /** Reads the own chat of a session for `chat_lesen`; absent offers no such tool. */
  readonly chatReader?: Pick<AgentChatReader, "read">;
  /** Keeps a confidential chat inside its own session; absent leaves the chat tools as they are. */
  readonly toolGuard?: Pick<AgentChatToolGuard, "tools" | "contextReader">;
  /**
   * The Lagebuch of the agents: its tools for every chat session
   * and the one hint line of a round. A function, because it is wired after
   * the sessions; absent offers no Lagebuch.
   */
  readonly logbook?: () => Pick<
    AgentLogbookService,
    "tools" | "hint" | "markSeen"
  > | null;
  /**
   * The recipes of the agents: the tool `rezept`, the record of tool
   * calls and the list of recipes a round is told about. Absent offers none.
   */
  readonly recipes?: Pick<AgentRecipeService, "tools" | "brief">;
  /**
   * Generates images with the model of a round in a conversation and hands
   * them to the answer; absent offers no `bilder_erzeugen`.
   */
  readonly images?: AgentImageToolDependencies;
  /**
   * Generates videos and sounds with the model of a round in a conversation
   * and hands them to the answer; absent offers no `video_erzeugen`
   * and no `audio_erzeugen`.
   */
  readonly media?: AgentMediaToolDependencies;
  /**
   * Stores the files a round in a conversation attaches to its answer, with
   * `chat_file_create` or as blocks of the answer, as attachments of the
   * answer in the conversation; absent offers no answer files there.
   */
  readonly answerFiles?: ConversationAnswerFileDependencies;
  /**
   * Searches and reads the attachments of the chat of a round. A
   * function, because the conversations are wired after the sessions; absent
   * or `null` offers no `anhaenge_suchen` and no `anhang_lesen`.
   */
  readonly attachments?: () => AgentAttachmentToolDependencies | null;
  readonly today?: () => string;
  /** Opens the live answer of a direct chat for the chat page; absent shows none. */
  readonly answers?: Pick<ConversationAnswerStream, "open">;
  /**
   * Folders the isolation of the toolkit's shell hides, such as the data and
   * agent folders; absent hides only the runtime folder.
   */
  readonly toolkitHiddenDirectories?: readonly string[];
  /** Waits between two looks of a background run at the chats of its agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** A message a person sends to an agent. */
export interface AgentMessage {
  readonly agentId: string;
  /** The text; empty for a message of files alone. */
  readonly text: string;
  /** The uploaded files of the chat session the message carries, in their order. */
  readonly attachmentIds: readonly string[];
  readonly clientMessageId: string | null;
  /** How the person sent it while the agent answered; absent joins the answer as before. */
  readonly delivery?: ConversationDelivery;
}

/** What a job of an agent answers and with whom. */
export interface AgentJobRequest {
  readonly agent: User;
  readonly employee: StoredAgentEmployee;
  /** The person the agent talks with; `null` for a learning run. */
  readonly person: User | null;
  readonly purpose: AgentConversationPurpose;
  /** Transfers conversation attachments before the temporary workspace is removed. */
  readonly consumeAnswer?: (answer: string) => Promise<void>;
  /** The stored conversation an answer belongs to; its session is kept per agent and conversation. */
  readonly conversationId?: string;
  /** How the resource view names the conversation of a kept session. */
  readonly conversationLabel?: string;
  readonly prepareTurn?: (
    afterSequence: number | null,
    isResumed?: boolean,
  ) => Promise<PicaAcpConversationTurn>;
  readonly text: string;
  /** The uploaded files of the chat session the message carries; absent for none. */
  readonly attachmentIds?: readonly string[];
  readonly clientMessageId: string | null;
  /**
   * The message is a scheduled one, such as the work of an automation
   * It waits for the running answer of its chat instead of
   * joining it, so its own answer exists.
   */
  readonly isScheduled?: boolean;
  /**
   * Runs the job on this model instead of the agent's own, such as
   * the cheap model of the background summary of the Lagebuch. A model that no
   * longer passes the rule for agents falls back to the agent's own.
   */
  readonly modelOverride?: {
    readonly connectionId: string;
    readonly model: string;
    /** The reasoning level of a model chosen for one chat; absent follows the model's default. */
    readonly reasoningEffort?: string | null;
  };
  /** Ends the wait of the message in the queue. */
  readonly signal?: AbortSignal;
  /** Called once when the message waits for a free place among the limits. */
  readonly onQueued?: () => void;
  /** Called once when the message got its place and its answer begins. */
  readonly onAdmitted?: () => void;
  /**
   * The message waits for a turn of its own after the running answer instead
   * of joining it ("Danach senden").
   */
  readonly isDeferred?: boolean;
  /** Shows the answer on the chat page while it is written; a direct chat opens its own. */
  readonly liveAnswer?: LiveAnswerSink;
}

/** A message of a person to an agent that waits for a free place. */
export interface QueuedAgentMessage {
  readonly id: string;
  readonly text: string;
}

export interface WaitingMessage extends QueuedAgentMessage {
  readonly controller: AbortController;
}

/** The key of the direct chat of a person with an agent. */
export function chatKey(agentId: string, personId: string): string {
  return `${agentId}:${personId}`;
}

/**
 * The session a chat keeps between its rounds: a direct chat and
 * a conversation answer every round through one session of the agent; a run
 * of the agent's own starts a session of its own each time.
 */
export function keptSessionOf(
  request: AgentJobRequest,
): PicaAcpEmployeeRun["keptSession"] {
  const { purpose, person, employee } = request;
  if (purpose !== "chat" && purpose !== "conversation") return undefined;
  const conversation =
    request.conversationLabel ??
    (person ? `Chat mit ${person.displayName}` : request.agent.displayName);
  return { conversation, revision: employee.revision };
}

/**
 * The chat whose model choice a round follows: the direct chat of
 * its person or its group; `null` for a run of the agent's own.
 */
export function chatModelKey(
  request: AgentJobRequest,
): AgentChatModelKey | null {
  const { purpose, person, conversationId, agent } = request;
  if (purpose === "chat" && person)
    return { agentId: agent.id, chatKind: "direct", chatId: person.id };
  if (purpose === "conversation" && conversationId !== undefined)
    return { agentId: agent.id, chatKind: "group", chatId: conversationId };
  return null;
}

/** A direct chat and a conversation are chats; every other purpose is a run of the agent's own. */
export function isChatPurpose(purpose: AgentConversationPurpose): boolean {
  return purpose === "chat" || purpose === "conversation";
}

/** The chat of a job: what its tools are bound to and what `chat_lesen` reads. */
export interface AgentChatScope {
  readonly scope: AgentChatToolScope;
  /** The session and its chat; `null` for a run of the agent's own. */
  readonly own: {
    readonly sessionId: string;
    readonly kind: "direct" | "group";
    readonly chatId: string;
    /** The person who addressed the agent in a conversation, who alone answers its questions. */
    readonly askerId?: string;
  } | null;
}

/** Whether the agent is busy with another request, so the message is queued instead. */
export function isSessionBusy(error: unknown): boolean {
  return error instanceof AgentExecutionError && error.code === "requestBusy";
}

/** The IDs of the files a message names; anything but a short list of IDs is invalid. */
function readAttachmentIds(input: unknown): readonly string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > CHAT_LIMITS.attachmentsPerMessage)
    throw new AgentEmployeeError("invalidInput");
  return input.map((id: unknown) => {
    if (typeof id !== "string" || !IDENTIFIER.test(id))
      throw new AgentEmployeeError("invalidInput");
    return id;
  });
}

/**
 * Reads the untrusted input of a chat message into its checked fields.
 *
 * @remarks
 * A message needs text or at least one file. The files are checked later
 * against the chat session, which alone knows which uploads are still unsent.
 */
export function readMessage(input: unknown): AgentMessage {
  const fields = readAgentObject(input);
  const { agentId, text, clientMessageId, delivery } = fields;
  if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
    throw new AgentEmployeeError("invalidInput");
  if (typeof text !== "string") throw new AgentEmployeeError("invalidInput");
  const attachmentIds = readAttachmentIds(fields.attachmentIds);
  const trimmed = text.trim();
  if (
    (trimmed === "" && attachmentIds.length === 0) ||
    Array.from(trimmed).length > CHAT_LIMITS.messageCharacters ||
    redactCredentials(trimmed) !== trimmed
  )
    throw new AgentEmployeeError("invalidInput");
  return {
    agentId,
    text: trimmed,
    attachmentIds,
    clientMessageId:
      typeof clientMessageId === "string" && IDENTIFIER.test(clientMessageId)
        ? clientMessageId
        : null,
    ...(delivery === "steer" || delivery === "after" ? { delivery } : {}),
  };
}
