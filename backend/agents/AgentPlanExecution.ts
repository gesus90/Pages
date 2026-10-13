import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import type { ExecutionAuthorizer } from "./ScopedExecution";
import type { TextExecution } from "./TextExecution";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
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
}

/** How the turn of a session ended, before Pages decides on acceptance. */
export interface PlanSessionTurn {
  /** The final answer of the agent, unredacted; the caller redacts before storing. */
  readonly output: string;
  readonly sessionId: string | null;
  /** `null` for a turn the runner completed; otherwise why it did not. */
  readonly failure: "timeout" | "cancelled" | "failed" | "incomplete" | null;
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
      const requestSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(120_000),
      ]);
      try {
        return await this.api.run(input, requestSignal);
      } catch (error: unknown) {
        if (signal.aborted) throw new AgentPlanCancelledError();
        if (requestSignal.aborted) throw new TextAssistantError("timeout");
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
    try {
      session = await this.cli.open(input, signal, observer);
    } catch (error: unknown) {
      release();
      throw error;
    }
    return {
      turn: session.turn,
      close: async () => {
        try {
          return await session.close();
        } finally {
          release();
        }
      },
    };
  }
}
