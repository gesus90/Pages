import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceState } from "@/definition/AcpResource";

interface LeaseLifecycle {
  readonly transition: (
    state: AcpResourceState,
    stepId?: string,
  ) => Promise<void>;
  readonly finish: (isConfirmed: boolean) => Promise<boolean>;
  /**
   * Proves the end of the processes from the durable evidence of the lease,
   * after the native closeout could not confirm it (PAGE-335).
   */
  readonly settle?: () => Promise<boolean>;
}

/** Keeps one lease across turns until its owner closes the session or its process ends. */
export class ScheduledAcpSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  private readonly session: PlanSession;
  private readonly lifecycle: LeaseLifecycle;
  private closing: Promise<PlanSessionClosed> | null = null;
  private isWorking = true;
  private hasAdapterTurn = false;
  private observer: PlanSessionObserver | undefined;

  public constructor(
    session: PlanSession,
    lifecycle: LeaseLifecycle,
    observer?: PlanSessionObserver,
  ) {
    this.observer = observer;
    this.session = session;
    this.lifecycle = lifecycle;
    this.turn = this.observeTurn(session.turn);
    void session.terminated
      ?.then(() => this.retire())
      .catch((caughtError: unknown) => {
        logCaughtError("ScheduledAcpSession", caughtError);

        // close() records an unconfirmed lease on every failure.
      });
  }

  /** Independent native owners retain their lease when HTTP detaches. */
  public get isDurable(): boolean {
    return this.session.isDurable === true;
  }

  /** Whether HTTP has withdrawn its observer without closing the native session. */
  public get isDetached(): boolean {
    return this.session.isDetached === true;
  }

  /** Detaches the underlying local owner; it does not release its capacity reservation. */
  public detach(): void {
    this.session.detach?.();
  }

  /** Reuses this process only while its original lease and native context remain open. */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    if (this.closing || this.isWorking || !this.session.next)
      throw new AgentError("plan_context_changed");
    this.hasAdapterTurn = false;
    this.observer = observer;
    this.isWorking = true;
    await this.lifecycle.transition("running", input.resourceContext?.stepId);
    if (this.closing) throw new AgentError("plan_context_changed");
    return this.observeTurn(this.session.next(input, signal, observer));
  }

  /** An adapter-started follow-up is active work, bounded by its owner's signal. */
  public async steer(
    prompt: readonly ContentBlock[],
  ): Promise<AcpSteerOutcome> {
    if (this.closing || !this.session.steer) return "inactive";
    const outcome = await this.session.steer(prompt);
    if (outcome === "startedNewTurn" && !this.closing) {
      this.hasAdapterTurn = true;
      await this.lifecycle.transition("running");
    }
    return outcome;
  }

  /** Interrupts the running prompt of a plan turn; the lease stays as it is. */
  public async interrupt(): Promise<boolean> {
    if (this.closing || !this.session.interrupt) return false;
    return this.session.interrupt();
  }

  /** Cancels the running tool call of a chat turn; the lease stays as it is (PAGE-303). */
  public async cancelTool(note: string): Promise<boolean> {
    if (this.closing || !this.session.cancelTool) return false;
    return this.session.cancelTool(note);
  }

  /** Whether a retirement or a close has begun, before the session reports its end. */
  public get isClosing(): boolean {
    return this.closing !== null;
  }

  /** Serializes closeout and only returns confirmed when capacity can safely be released. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }

  private async observeTurn(
    pending: Promise<PlanSessionTurn>,
  ): Promise<PlanSessionTurn> {
    try {
      return await pending;
    } finally {
      this.isWorking = false;
      if (!this.closing && !this.hasAdapterTurn)
        await this.lifecycle.transition("idle");
    }
  }

  private async retire(): Promise<void> {
    if (this.closing) return;
    try {
      const closed = await this.close();
      this.observer?.retired?.(closed, "process_exit");
    } catch (error: unknown) {
      logCaughtError("ScheduledAcpSession", error);

      this.observer?.retired?.(
        {
          exit: null,
          endedAt: new Date().toISOString(),
          leftovers: 0,
          isConfirmed: false,
        },
        "process_exit",
      );
      throw error;
    }
  }

  private async closeOnce(): Promise<PlanSessionClosed> {
    await this.lifecycle.transition("closing");
    try {
      const closed = await this.session.close();
      const isConfirmed = await this.lifecycle.finish(
        closed.isConfirmed || (await this.settleLease()),
      );
      return { ...closed, isConfirmed };
    } catch (error: unknown) {
      logCaughtError("ScheduledAcpSession", error);

      await this.lifecycle.finish(await this.settleLease());
      throw error;
    }
  }

  /** A failed proof keeps the lease, so the periodic check decides later. */
  private async settleLease(): Promise<boolean> {
    try {
      return (await this.lifecycle.settle?.()) ?? false;
    } catch (error: unknown) {
      logCaughtError("ScheduledAcpSession", error);
      return false;
    }
  }
}
