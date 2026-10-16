import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceState } from "@/definition/AcpResource";

interface LeaseLifecycle {
  readonly idleTimeout: number;
  readonly transition: (
    state: AcpResourceState,
    stepId?: string,
  ) => Promise<void>;
  readonly finish: (isConfirmed: boolean) => Promise<boolean>;
}

/** Keeps one lease across turns and retires idle native sessions without replaying work. */
export class ScheduledAcpSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  private readonly session: PlanSession;
  private readonly lifecycle: LeaseLifecycle;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closing: Promise<PlanSessionClosed> | null = null;
  private isWorking = true;
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
      ?.then(() => this.retire("process_exit"))
      .catch(() => {
        // close() records an unconfirmed lease on every failure.
      });
  }

  /** Reuses this process only while its original lease and native context remain open. */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    if (this.closing || this.isWorking || !this.session.next)
      throw new AgentError("plan_context_changed");
    clearTimeout(this.idleTimer);
    this.observer = observer;
    this.isWorking = true;
    await this.lifecycle.transition("running", input.resourceContext?.stepId);
    if (this.closing) throw new AgentError("plan_context_changed");
    return this.observeTurn(this.session.next(input, signal, observer));
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
      if (!this.closing) {
        await this.lifecycle.transition("idle");
        this.armIdleTimer();
      }
    }
  }

  private armIdleTimer(): void {
    if (this.closing) return;
    this.idleTimer = setTimeout(() => {
      void this.retire("idle_timeout").catch(() => {
        // The lease stays occupied; the resource overview reports cleanup_failed.
      });
    }, this.lifecycle.idleTimeout);
    this.idleTimer.unref();
  }

  private async retire(reason: "idle_timeout" | "process_exit"): Promise<void> {
    if (this.closing) return;
    try {
      const closed = await this.close();
      this.observer?.retired?.(closed, reason);
    } catch (error: unknown) {
      this.observer?.retired?.(
        {
          exit: null,
          endedAt: new Date().toISOString(),
          leftovers: 0,
          isConfirmed: false,
        },
        reason,
      );
      throw error;
    }
  }

  private async closeOnce(): Promise<PlanSessionClosed> {
    clearTimeout(this.idleTimer);
    await this.lifecycle.transition("closing");
    try {
      const closed = await this.session.close();
      const isConfirmed = await this.lifecycle.finish(closed.isConfirmed);
      return { ...closed, isConfirmed };
    } catch (error: unknown) {
      await this.lifecycle.finish(false);
      throw error;
    }
  }
}
