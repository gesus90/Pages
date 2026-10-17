import { AgentError } from "@/backend/error/AgentErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ExecutionAuthorizer } from "./ScopedExecution";
import type {
  AcpChatOptions,
  AcpSessionListener,
  AcpSteerOutcome,
} from "@/backend/agents/acp/AcpChat";
import type { TextExecution } from "./TextExecution";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type {
  AgentPlanProcessExit,
  AgentPlanSessionMode,
} from "@/definition/AgentPlanSession";

/** A CLI session of one plan node, in its authorized workspace. */
export interface AgentPlanSessionInput extends AgentPlanExecutionInput {
  readonly directory: string;
  readonly options: AgentRunOptions;
  /** Tags every process of the session. */
  readonly instanceId: string;
  /** The local MCP process, when the node is bound to tickets. */
  readonly mcp: CliSessionMcp | null;
  /** Makes the session a Pica chat session: its own profile, MCP bridge, resume and updates. */
  readonly chat?: AcpChatOptions;
  /** Records the updates of a plan session into its PageAgentCLI history; a chat uses its own listener. */
  readonly journal?: AcpSessionListener;
}

/** Receives the milestones of a session while it runs. */
export interface PlanSessionObserver {
  readonly started: (details: {
    readonly mode: Exclude<AgentPlanSessionMode, "request">;
    readonly processId: number | null;
    readonly startedAt: string;
    readonly arguments: readonly string[];
    readonly unattended: string;
  }) => void;
  readonly identified: (sessionId: string) => void;
  /** Reports automatic retirement so retained run records do not remain silently open. */
  readonly retired?: (
    closed: PlanSessionClosed,
    reason: "idle_timeout" | "process_exit",
  ) => void;
  /** Reports the newest events while the turn runs; the turn reports them again at its end. */
  readonly progressed?: (events: readonly string[]) => void;
}

/** How the runner ended its turn, independently of business progress or report content. */
export interface PlanSessionTurn {
  /** The final answer of the agent, unredacted; the caller redacts before storing. */
  readonly output: string;
  readonly sessionId: string | null;
  /** `null` for a turn the runner completed; otherwise why it did not. */
  readonly failure: "timeout" | "cancelled" | "failed" | "incomplete" | null;
  /**
   * Why the runner refused to work as configured, such as a model its catalog
   * does not offer; `null` when it accepted the configuration.
   */
  readonly errorCode: AgentErrorCode | null;
  readonly endedAt: string;
  readonly permissionDenials: number;
  readonly effective: Readonly<Record<string, string>>;
  readonly events: readonly string[];
}

/** How a session was closed and whether nothing of it is left. */
export interface PlanSessionClosed {
  readonly exit: AgentPlanProcessExit | null;
  readonly endedAt: string;
  /** Processes of the session found and ended after the runner exited. */
  readonly leftovers: number;
  readonly isConfirmed: boolean;
}

/** A running session: first its turn, then its closing. */
export interface PlanSession {
  readonly turn: Promise<PlanSessionTurn>;
  /** Native process exit, used to clean up crashed idle ACP sessions. */
  readonly terminated?: Promise<void>;
  /** Starts a new step in this same native session; absent for unsupported runners. */
  next?(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn>;
  /** Adds a prompt to the running turn; absent for runners without steering. */
  steer?(prompt: readonly ContentBlock[]): Promise<AcpSteerOutcome>;
  /** Ends the session and its helpers; resolves only after the confirmation. */
  close(): Promise<PlanSessionClosed>;
}

/** The CLI side of plan execution. */
export interface PlanSessionRunner {
  open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession>;
}

/** Runs plan nodes: requests to API connections and sessions of CLI runners. */
export interface PlanExecution {
  /** A request to an API connection; it uses no tools and no workspace. */
  run(input: AgentPlanExecutionInput, signal: AbortSignal): Promise<string>;
  /** A session of the CLI runner the connection of the node determines. */
  open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession>;
}

/**
 * Reuses credential boundaries and permits independent plan steps to share a verified connection.
 *
 * @remarks
 * The scope of the connection is checked right before every request and
 * every process start. A pinned provider is never redirected: an API
 * connection never becomes a CLI session or the other way round.
 */
export class AgentPlanExecution implements PlanExecution {
  private readonly api: TextExecution;
  private readonly cli: PlanSessionRunner;
  private readonly operations: AgentOperationRegistry;
  private readonly authorizer: ExecutionAuthorizer;

  public constructor(
    api: TextExecution,
    cli: PlanSessionRunner,
    operations: AgentOperationRegistry,
    authorizer: ExecutionAuthorizer,
  ) {
    this.api = api;
    this.cli = cli;
    this.operations = operations;
    this.authorizer = authorizer;
  }

  /** Never passes credential material through a plan. */
  public async run(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    if (!isApiProvider(input.agent.connection.provider))
      throw new AgentError("provider_invalid");
    await this.authorizer.requireUser(input.userId, input.agent.connection.id);
    const release = this.operations.acquireExecution(input.agent.connection.id);
    try {
      await input.beforeStart?.();
      try {
        const output = await this.api.run(input, signal);
        signal.throwIfAborted();
        return output;
      } catch (error: unknown) {
        if (
          signal.aborted &&
          signal.reason instanceof DOMException &&
          signal.reason.name === "TimeoutError"
        )
          throw new TextAssistantError("timeout");
        if (signal.aborted) throw new AgentPlanCancelledError();
        throw error;
      }
    } finally {
      release();
    }
  }

  /** Holds the connection until the session is closed, not only until its turn ended. */
  public async open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    if (isApiProvider(input.agent.connection.provider))
      throw new AgentError("provider_invalid");
    await this.authorizer.requireUser(input.userId, input.agent.connection.id);
    const release = this.operations.acquireExecution(input.agent.connection.id);
    let session: PlanSession;
    const mustConfirmCleanup = input.agent.connection.provider === "opencode";
    function observe(target: PlanSessionObserver): PlanSessionObserver {
      if (!mustConfirmCleanup) return target;
      return {
        ...target,
        retired: (closed, reason) => {
          if (closed.isConfirmed) release();
          target.retired?.(closed, reason);
        },
      };
    }
    try {
      session = await this.cli.open(input, signal, observe(observer));
    } catch (error: unknown) {
      if (!mustConfirmCleanup || !(error instanceof AcpCleanupUnconfirmedError))
        release();
      throw error;
    }
    const steer = session.steer?.bind(session);
    return {
      turn: session.turn,
      ...(steer ? { steer } : {}),
      ...(session.next
        ? {
            next: async (
              next: AgentPlanExecutionInput,
              nextSignal: AbortSignal,
              nextObserver: PlanSessionObserver,
            ) => {
              await this.authorizer.requireUser(
                next.userId,
                next.agent.connection.id,
              );
              await next.beforeStart?.();
              if (!session.next) throw new AgentError("plan_step_failed");
              return session.next(next, nextSignal, observe(nextObserver));
            },
          }
        : {}),
      close: async () => {
        let isConfirmed = false;
        try {
          const closed = await session.close();
          isConfirmed = closed.isConfirmed;
          return closed;
        } finally {
          if (isConfirmed || !mustConfirmCleanup) release();
        }
      },
    };
  }
}
