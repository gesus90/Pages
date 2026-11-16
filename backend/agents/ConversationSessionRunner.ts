import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentPlanProcessExit } from "@/definition/AgentPlanSession";

/**
 * Whom a conversation session belongs to.
 * @remarks
 * A conversation session is bound to one agent in one conversation. It is not
 * bound to a plan, a step or an attempt: it takes any number of rounds, rests
 * between them and ends only through a release.
 */
export interface ConversationSessionOwner {
  /** The conversation of the agent: one session per agent and conversation. */
  readonly conversationId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** The conversation, as the memory of the agent names it. */
  readonly conversation: string;
  /**
   * Connection, model, effort, profile, access, folder and credentials. A
   * round with another value never continues the session.
   */
  readonly fingerprint: string;
}

/** Why a conversation session is released. */
export type ConversationReleaseReason =
  /** The person stopped the round, or its deadline ran out. */
  | "stop"
  /** The idle time of the agent ran out between two rounds. */
  | "idle"
  /** The next round opens a new native session that resumes the stored one. */
  | "reconnect"
  /** The configuration or the agent of the next round differs. */
  | "configuration"
  /** A turn failed or the native process ended on its own. */
  | "failure"
  /** A waiting start takes the place of the longest resting session. */
  | "capacity"
  /** The working folder of the conversation is removed. */
  | "workspace"
  /** The conversation is closed or deleted. */
  | "deletion"
  /** The service shuts down. */
  | "shutdown";

/** What a release left behind. */
export interface ConversationRelease {
  readonly reason: ConversationReleaseReason;
  readonly exit: AgentPlanProcessExit | null;
  readonly endedAt: string;
  /** Processes of the session found and ended after the runner exited. */
  readonly leftovers: number;
  /**
   * Whether the native process, its helpers and its lease are provably gone.
   * Only a confirmed release frees the working folder and lets a new native
   * session of the same conversation start.
   */
  readonly isConfirmed: boolean;
}

/** The agent and the conversation a bridge credential was issued to. */
export interface ConversationBridgeOwner {
  readonly agentId: string;
  readonly conversationId: string;
}

/**
 * The tool credential of one conversation session.
 * @remarks
 * The native session reads its credential once, when it starts, so the
 * credential lives as long as the session and never as long as one round. It
 * belongs to one agent in one conversation; a round of anyone else cannot take
 * it over. It admits a call only while the round it is bound to runs, and the
 * runner revokes it when the session is released.
 */
export interface ConversationBridgeChannel {
  readonly owner: ConversationBridgeOwner;
  readonly descriptor: {
    readonly url: string;
    readonly authorization: string;
  };
  /** Revokes the credential; repeated calls do nothing. */
  readonly close: () => void;
}

/** What a runner opens a conversation session with. */
export interface ConversationSessionStart {
  readonly owner: ConversationSessionOwner;
  /**
   * The native session and its first round. `chat.resumeSessionId` names the
   * stored native session the runner continues instead of starting a new one.
   */
  readonly input: AgentPlanSessionInput;
  /** Lives as long as the session, not as the round that opens it. */
  readonly signal: AbortSignal;
  /** Hears the native session identifier for the resume after the idle time. */
  readonly observer: PlanSessionObserver;
  /** The credential of the session, or `null` for a runner without the bridge. */
  readonly bridge: ConversationBridgeChannel | null;
}

/** A session a runner opened, with the first round already running. */
export interface ConversationSessionOpened {
  readonly session: ConversationRunnerSession;
  readonly firstRound: Promise<PlanSessionTurn>;
}

/**
 * A native session that answers the rounds of one conversation.
 * @remarks
 * The session outlives its rounds. A round is one prompt turn of the same
 * native process and the same agent session; two rounds never overlap. The
 * session ends only through {@link ConversationRunnerSession.release}.
 */
export interface ConversationRunnerSession {
  /** Tags every process of the session. */
  readonly instanceId: string;
  /**
   * The native agent session identifier once the adapter reported it, or
   * `null`; a later start passes it as `chat.resumeSessionId` to resume it.
   */
  nativeSessionId(): string | null;
  /**
   * Settles with the release record when the native process ends on its own;
   * it never rejects. A release the pool asked for settles it with the same record.
   */
  readonly exited: Promise<ConversationRelease>;
  /** Runs the next round in the same native session. */
  round(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn>;
  /** Adds a prompt to the running round; absent for runners without steering. */
  steer?(prompt: readonly ContentBlock[]): Promise<AcpSteerOutcome>;
  /** Interrupts the running prompt; the session stays for the next round. */
  interrupt?(): Promise<boolean>;
  /** Cancels the running tool call and continues the round with the note. */
  cancelTool?(note: string): Promise<boolean>;
  /**
   * Revokes the bridge credential, ends the native process and its helpers and
   * resolves only after the confirmation. A repeated call returns the first
   * record; it never rejects, an unconfirmed end is `isConfirmed: false`.
   */
  release(reason: ConversationReleaseReason): Promise<ConversationRelease>;
}

/** The runner side of conversation sessions, next to the plan session runner. */
export interface ConversationSessionRunner {
  /**
   * Opens the native session of a conversation, resuming the stored one when
   * the start names it, and runs its first round.
   */
  open(start: ConversationSessionStart): Promise<ConversationSessionOpened>;
}
