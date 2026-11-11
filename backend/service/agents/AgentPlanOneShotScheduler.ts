import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanOneShotService } from "./AgentPlanOneShotService";
import type { AgentPlanRunObserver } from "./AgentPlanRunObservers";

/** How often the deadlines of one-time plans are checked. */
const DEFAULT_CHECK_INTERVAL_MS = 15_000;

/** Starts a repeating check and returns the function that ends it; replaceable so no real time has to pass. */
export type OneShotTimer = (
  check: () => void,
  intervalMs: number,
) => () => void;

function realTimer(check: () => void, intervalMs: number): () => void {
  const handle = setInterval(check, intervalMs);
  handle.unref();
  return () => clearInterval(handle);
}

/**
 * Sets the deadline of one-time plans when a run succeeds and carries the deletion out when it falls due.
 *
 * @remarks
 * As an observer it only queues its own work. The check at start and then at
 * a fixed interval reads the deadlines from the database, so a deletion that
 * fell due while the service was down is carried out right after the start.
 */
export class AgentPlanOneShotScheduler implements AgentPlanRunObserver {
  private readonly service: Pick<
    AgentPlanOneShotService,
    "scheduleAfterSuccess" | "cancel" | "deleteDue"
  >;
  private readonly timer: OneShotTimer;
  private readonly intervalMs: number;
  private stopTimer: (() => void) | null = null;
  private isChecking = false;

  public constructor(input: {
    readonly service: AgentPlanOneShotScheduler["service"];
    readonly timer?: OneShotTimer;
    readonly intervalMs?: number;
  }) {
    this.service = input.service;
    this.timer = input.timer ?? realTimer;
    this.intervalMs = input.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  /** Starts the regular check and runs one at once for deadlines that passed during a stop. */
  public start(): void {
    if (this.stopTimer) return;
    this.stopTimer = this.timer(() => void this.check(), this.intervalMs);
    void this.check();
  }

  /** Ends the regular check. */
  public stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }

  /** A run that ended as `succeeded` starts the deadline of its one-time plan. */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    if (next.status !== "succeeded" || previous.status === "succeeded") return;
    this.queue("schedule", () =>
      this.service.scheduleAfterSuccess(next.planId),
    );
  }

  /** A new run of the plan cancels a deadline: the plan is deleted only after the run that ends it. */
  public runStarted(run: AgentPlanRun): void {
    this.queue("cancel", () => this.service.cancel(run.planId));
  }

  /**
   * Carries out every deletion that is due, one check at a time.
   *
   * @returns The identifiers of the plans that were deleted.
   */
  public async check(): Promise<readonly AgentPlan["id"][]> {
    if (this.isChecking) return [];
    this.isChecking = true;
    try {
      return await withBackgroundDatabaseWork("one_shot_plan_deletion", () =>
        this.service.deleteDue(),
      );
    } catch (error: unknown) {
      logCaughtError("AgentPlanOneShotScheduler", error);
      return [];
    } finally {
      this.isChecking = false;
    }
  }

  private queue(label: string, work: () => Promise<unknown>): void {
    void withBackgroundDatabaseWork(`one_shot_plan_${label}`, work).catch(
      (error: unknown) => {
        logCaughtError("AgentPlanOneShotScheduler", error);
      },
    );
  }
}
