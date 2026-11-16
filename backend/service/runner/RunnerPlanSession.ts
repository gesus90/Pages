import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import { AgentError } from "@/backend/error/AgentErrors";
import { runnerJobResultSchema } from "@/definition/RunnerProtocol";

import type { RunnerJobResult } from "@/definition/RunnerProtocol";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

interface RunnerTurnControl {
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
  readonly resume: string | null;
  readonly turn: number;
  readonly historyBase: number;
}

interface RunnerSessionContext {
  readonly execute: (
    input: AgentPlanExecutionInput,
    control: RunnerTurnControl,
  ) => Promise<RunnerJobResult>;
  readonly setPaused: (isPaused: boolean) => Promise<void>;
}

interface RunnerSessionControl {
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
  readonly resume: string | null;
  readonly initialTurn?: number;
  readonly initialBase?: number;
}

/** Keeps a native session ID across runner-owned jobs; every worker confirms its own cleanup. */
export class RunnerPlanSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  private readonly context: RunnerSessionContext;
  private pending: Promise<PlanSessionTurn>;
  private sessionId: string | null;
  private result: RunnerJobResult | null = null;
  private controller: AbortController | null = null;
  private isClosed = false;
  private turns = 0;
  private historyBase = 0;
  private recordingAttemptId: string | undefined;

  public constructor(
    input: AgentPlanExecutionInput,
    control: RunnerSessionControl,
    context: RunnerSessionContext,
  ) {
    this.context = context;
    this.sessionId = control.resume;
    this.turns = (control.initialTurn ?? 1) - 1;
    this.historyBase = control.initialBase ?? 0;
    this.recordingAttemptId = input.recording?.key.attemptId;
    this.turn = this.execute(input, control.signal, control.observer);
    this.pending = this.turn;
  }

  /** Continues the exact provider thread after the preceding worker has closed. */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    await this.pending;
    if (
      this.isClosed ||
      !this.sessionId ||
      this.result?.closeout !== "confirmed"
    )
      throw new AgentError("plan_session_unavailable");
    this.pending = this.execute(input, signal, observer);
    return this.pending;
  }

  /** Freezes the original cgroup through the runner's acknowledged command. */
  public setPaused(isPaused: boolean): Promise<void> {
    return this.context.setPaused(isPaused);
  }

  /** Cancels an unfinished worker and releases only after runner closeout evidence. */
  public async close(): Promise<PlanSessionClosed> {
    this.isClosed = true;
    this.controller?.abort();
    try {
      await this.pending;
    } catch {
      // A missing terminal receipt keeps ownership unconfirmed.
    }
    const isConfirmed = this.result?.closeout === "confirmed";
    return {
      exit: {
        code: this.result?.exitCode ?? null,
        signal: this.result?.signal ?? null,
      },
      endedAt: new Date().toISOString(),
      leftovers: 0,
      isConfirmed,
      containment: isConfirmed ? "pid_namespace" : undefined,
    };
  }

  private async execute(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    const controller = new AbortController();
    this.controller = controller;
    this.result = null;
    if (this.recordingAttemptId !== input.recording?.key.attemptId) {
      this.turns = 0;
      this.historyBase = 0;
    }
    this.recordingAttemptId = input.recording?.key.attemptId;
    this.turns += 1;
    const result = await this.context.execute(input, {
      signal: AbortSignal.any([signal, controller.signal]),
      observer,
      resume: this.sessionId,
      turn: this.turns,
      historyBase: this.historyBase,
    });
    this.controller = null;
    this.result = runnerJobResultSchema.parse(result);
    this.historyBase += result.historyLength ?? 0;
    const terminal = result.terminal;
    if (terminal?.sessionId) {
      if (this.sessionId && this.sessionId !== terminal.sessionId)
        throw new AgentError("acp_session_resume_failed");
      this.sessionId = terminal.sessionId;
      observer.identified(this.sessionId);
    }
    if (result.continuation)
      observer.capabilities?.({
        canResume: result.continuation.canResume,
        canLoad: false,
        adapter: input.agent.connection.provider,
      });
    return completedTurn(result, this.sessionId);
  }
}

function completedTurn(
  result: RunnerJobResult,
  sessionId: string | null,
): PlanSessionTurn {
  return {
    ...(isPlanRetryCode(result.failureCode)
      ? {
          providerFailure: {
            code: result.failureCode,
            resetAt: result.resetAt ?? null,
          },
        }
      : {}),
    output: result.output ?? "",
    sessionId,
    failure: turnFailure(result),
    errorCode: result.failureCode ?? null,
    endedAt: new Date().toISOString(),
    permissionDenials: 0,
    effective: {},
    events: [],
  };
}

function turnFailure(result: RunnerJobResult): PlanSessionTurn["failure"] {
  if (result.reason === "cancelled") return "cancelled";
  if (result.reason === "timeout") return "timeout";
  if (result.closeout !== "confirmed") return "incomplete";
  return result.exitCode === 0 && !result.reason && !result.failureCode
    ? null
    : "failed";
}
