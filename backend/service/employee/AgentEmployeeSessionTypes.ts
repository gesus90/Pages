import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { CHAT_LIMITS } from "@/definition/Chat";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentConversationPurpose } from "@/backend/database/repositories/employee/AgentConversationRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type {
  PicaAcpEmployeeRun,
  PicaAcpService,
} from "../chat/acp/PicaAcpService";
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
  /** The limits of concurrent sessions (PAGE-304); absent runs every session at once. */
  readonly slots?: Pick<AgentSessionSlots, "acquire">;
  /** The MCP servers of the host for "Arbeitsplatz" and YOLO (PAGE-303); absent gives none. */
  readonly accessEnvironment?: Pick<
    AgentAccessEnvironmentService,
    "chatServers"
  >;
  /** Attaches files of the working folder with the agent's rights (PAGE-303); absent offers no such tool. */
  readonly hostFiles?: Pick<AgentHostFiles, "attach">;
  /** Keeps `MEMORY.md` current after each answer of a direct chat (PAGE-305); absent records nothing. */
  readonly recorder?: Pick<AgentMemoryRecorder, "record">;
  /**
   * The Pages tools to read chats and send messages (PAGE-311). A function,
   * because the conversations are wired after the sessions; `null` where none.
   */
  readonly agentChat?: () => AgentChatTools | null;
  /** An unused ID for a new chat session. */
  readonly createSessionId: () => string;
  /**
   * Reads the stored context of a group as the agent's own account
   * (PAGE-296); offered to the agent as `read_conversation_context`.
   */
  readonly conversationContext?: {
    readForAgent(agentId: string, input: unknown): Promise<unknown>;
  };
  /**
   * What happens to a chat session after its rounds, such as the restart at
   * a full context (PAGE-376). A function, because it is wired after the
   * sessions; `null` runs without it.
   */
  readonly lifecycle?: () => Pick<
    AgentChatSessionLifecycle,
    "restartIfNeeded" | "afterRound"
  > | null;
  /** Reads the own chat of a session for `chat_lesen` (PAGE-376); absent offers no such tool. */
  readonly chatReader?: Pick<AgentChatReader, "read">;
  /** Keeps a confidential chat inside its own session (PAGE-376); absent leaves the chat tools as they are. */
  readonly toolGuard?: Pick<AgentChatToolGuard, "tools" | "contextReader">;
  /**
   * The Lagebuch of the agents (PAGE-377): its tools for every chat session
   * and the one hint line of a round. A function, because it is wired after
   * the sessions; absent offers no Lagebuch.
   */
  readonly logbook?: () => Pick<
    AgentLogbookService,
    "tools" | "hint" | "markSeen"
  > | null;
  /**
   * The recipes of the agents (PAGE-378): the tool `rezept`, the record of tool
   * calls and the list of recipes a round is told about. Absent offers none.
   */
  readonly recipes?: Pick<AgentRecipeService, "tools" | "brief">;
  readonly today?: () => string;
  /** Waits between two looks of a background run at the chats of its agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** A message a person sends to an agent. */
export interface AgentMessage {
  readonly agentId: string;
  readonly text: string;
  readonly clientMessageId: string | null;
}

/** What a job of an agent answers and with whom. */
export interface AgentJobRequest {
  readonly agent: User;
  readonly employee: StoredAgentEmployee;
  /** The person the agent talks with; `null` for a learning run. */
  readonly person: User | null;
  readonly purpose: AgentConversationPurpose;
  /** The stored conversation an answer belongs to (PAGE-276); its session is kept per agent and conversation. */
  readonly conversationId?: string;
  /** How the resource view names the conversation of a kept session (PAGE-335). */
  readonly conversationLabel?: string;
  readonly text: string;
  readonly clientMessageId: string | null;
  /**
   * The message is a scheduled one, such as the work of an automation
   * (PAGE-376): it waits for the running answer of its chat instead of
   * joining it, so its own answer exists.
   */
  readonly isScheduled?: boolean;
  /**
   * Runs the job on this model instead of the agent's own (PAGE-377), such as
   * the cheap model of the background summary of the Lagebuch. A model that no
   * longer passes the rule for agents falls back to the agent's own.
   */
  readonly modelOverride?: {
    readonly connectionId: string;
    readonly model: string;
  };
  /** Ends the wait of the message in the queue (PAGE-304). */
  readonly signal?: AbortSignal;
  /** Called once when the message waits for a free place among the limits. */
  readonly onQueued?: () => void;
  /** Called once when the message got its place and its answer begins. */
  readonly onAdmitted?: () => void;
}

/** A message of a person to an agent that waits for a free place (PAGE-304). */
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
 * The session a chat keeps between its rounds (PAGE-335): a direct chat and
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
  } | null;
}

/** Whether the agent is busy with another request, so the message is queued instead (PAGE-376). */
export function isSessionBusy(error: unknown): boolean {
  return error instanceof AgentExecutionError && error.code === "requestBusy";
}

/** Reads the untrusted input of a chat message into its checked fields. */
export function readMessage(input: unknown): AgentMessage {
  const fields = readAgentObject(input);
  const { agentId, text, clientMessageId } = fields;
  if (typeof agentId !== "string" || !IDENTIFIER.test(agentId))
    throw new AgentEmployeeError("invalidInput");
  if (typeof text !== "string") throw new AgentEmployeeError("invalidInput");
  const trimmed = text.trim();
  if (
    trimmed === "" ||
    Array.from(trimmed).length > CHAT_LIMITS.messageCharacters ||
    redactCredentials(trimmed) !== trimmed
  )
    throw new AgentEmployeeError("invalidInput");
  return {
    agentId,
    text: trimmed,
    clientMessageId:
      typeof clientMessageId === "string" && IDENTIFIER.test(clientMessageId)
        ? clientMessageId
        : null,
  };
}
