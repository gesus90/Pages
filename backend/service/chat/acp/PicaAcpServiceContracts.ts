import type { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import type { AgentHostFileTarget } from "@/backend/service/employee/AgentHostFiles";
import type { AgentChatTools } from "@/definition/AgentChat";
import type { AgentRecipeTools } from "@/definition/AgentDreaming";
import type { AgentLogbookTools } from "@/definition/AgentLogbook";
import type { ChatJob, ChatJobEntry } from "@/definition/ChatJob";
import type { User } from "@/definition/User";

import type { ChatAttachmentService } from "../ChatAttachmentService";
import type { AgentToolkitJob } from "../toolkit/AgentToolkitContracts";
import type { PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpJobDependencies } from "./PicaAcpJob";
import type { PicaAcpRunner } from "./PicaAcpRunners";
import type { PicaAcpSessionPool } from "./PicaAcpSessionPool";
import type { PicaAcpConversationTurn } from "./PicaAcpSteering";
import type { PicaAcpWorkspace } from "./PicaAcpWorkspace";

/** A job of a conversation with its journal (PAGE-303). */
export interface ChatJobJournal {
  readonly job: ChatJob;
  readonly events: readonly ChatJobEntry[];
}

/** What the ACP path of Pica is built from. */
export interface PicaAcpServiceDependencies extends PicaAcpJobDependencies {
  readonly admit?: <Result>(work: () => Promise<Result>) => Promise<Result>;
  readonly jobs: ChatJobRepository;
  readonly steers: ChatSteerRepository;
  readonly acpSessions: ChatAcpSessionRepository;
  readonly attachments: Pick<
    ChatAttachmentService,
    "pending" | "link" | "readText" | "readBytes"
  >;
  /** The registry of running chat answers: one per person, its deadline and the shutdown. */
  readonly requests: ChatRequestRegistry;
  readonly workspace: PicaAcpWorkspace;
  readonly requireCurrent?: (
    userId: string,
    assignment: ResolvedAgentAssignment,
  ) => Promise<void>;
  /** The chat sessions agent employees keep between rounds (PAGE-335); absent opens one per job. */
  readonly pool?: Pick<
    PicaAcpSessionPool,
    "open" | "close" | "closeForWorkspace" | "keepWorkspace"
  >;
}

/** A sent message after validation. */
export interface PicaAcpRequest {
  /** The ID the browser gave the message; a message is stored once per ID. */
  readonly clientMessageId: string | null;
  readonly sessionId: string;
  readonly text: string;
  readonly attachmentIds: unknown;
}

/**
 * How a job of an agent employee differs from one of Pica (PAGE-266).
 *
 * @remarks
 * The job runs as the agent's own account, with the runner of its stored
 * access. Each round pins its configuration and checks account availability
 * again before every turn and tool call. Pica's switch does not admit it.
 */
export interface PicaAcpEmployeeRun {
  /** Stages conversation file attachments while the workspace still exists. */
  readonly consumeAnswer?: (answer: string) => Promise<void>;
  readonly runner: PicaAcpRunner;
  readonly prepareTurn?: (
    afterSequence: number | null,
    isResumed?: boolean,
  ) => Promise<PicaAcpConversationTurn>;
  /** Browser access derived from the stored employee level, never model input. */
  readonly hasBrowser?: boolean;
  /** Rechecks account availability while keeping this round's configuration pinned. */
  readonly requireCurrent: () => Promise<void>;
  /** Requires the connection pinned for this round, even if the next round's settings changed. */
  readonly requireConnection: (connectionId: string) => Promise<void>;
  /** Searches the agent's own memory archive. */
  readonly searchMemory: (query: string) => Promise<unknown>;
  /** Reads a group of the agent's own account (PAGE-296). */
  readonly readConversationContext?: (input: unknown) => Promise<unknown>;
  /** Reads the messages of the chat of the job's session after a position, for `chat_lesen` (PAGE-376). */
  readonly readOwnChat?: (input: unknown) => Promise<unknown>;
  /** The Lagebuch tools of the job's chat session (PAGE-377); absent for a run of the agent's own. */
  readonly logbook?: AgentLogbookTools;
  /** The recipe tool and the record of tool calls of the job's chat session (PAGE-378); absent for a run of the agent's own. */
  readonly recipes?: AgentRecipeTools;
  /**
   * A short run of the agent's own, such as the upkeep of its memory
   * (PAGE-376): it starts a new agent session and never continues an
   * earlier one, so it carries no context of a chat.
   */
  readonly isFreshSession?: boolean;
  /**
   * Attaches a file of the job's working folder to a ticket or a wiki page
   * with the agent's rights; present only with host tools (PAGE-303).
   */
  readonly attachFile?: (
    directory: string,
    target: AgentHostFileTarget,
    file: string,
  ) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  /**
   * Called once when the job ended, however it ended, so the caller frees
   * the place of the session among the limits of the agent (PAGE-304).
   */
  readonly onSettled?: () => void;
  /** The Pages tools to read chats and send messages (PAGE-311); absent where none run. */
  readonly agentChat?: AgentChatTools;
  /**
   * Creates the toolkit of the job in its working folder (PAGE-390): shell,
   * file and web tools and the policy of the agent's access level and
   * switched-off groups. Its background runs end with the job.
   */
  readonly toolkit?: (directory: string) => AgentToolkitJob;
  /**
   * Keeps the session of the chat for the next round (PAGE-335): the label of
   * the conversation for the resource view and the revision of the agent,
   * retained as metadata. Only session configuration changes restart it.
   * Absent opens a session per job.
   */
  readonly keptSession?: {
    readonly conversation: string;
    readonly revision: number;
  };
}

/** What a new job is started from; the agent is resolved by the caller for this message. */
export interface PicaAcpStart {
  readonly actor: User;
  readonly request: PicaAcpRequest;
  readonly agent: ResolvedAgentAssignment;
  /** Instructions and context with the transcript; a continued session leaves the transcript out. */
  readonly brief: PicaTurnBrief;
  /** Present for a job of an agent employee instead of Pica. */
  readonly employee?: PicaAcpEmployeeRun;
}
