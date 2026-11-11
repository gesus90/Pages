import { randomUUID } from "node:crypto";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { nextRunAfter } from "./AutomationSchedule";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationEventIntake } from "./AutomationEventIntake";
import type { AutomationRunExecutor } from "./AutomationRunExecutor";

/** How often the scheduler looks for due work. */
const TICK_MILLISECONDS = 1000;
/** Due automations and startable runs handled per pass. */
const BATCH = 50;
/** Passes between two cleanups of old agent deliveries (about an hour). */
const CLEANUP_PASSES = 3600;
/** How long ended deliveries without a run stay. */
const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** What the scheduler is built from; the clock is exchangeable for tests. */
export interface AutomationSchedulerDependencies {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly executor: AutomationRunExecutor;
  readonly intake: AutomationEventIntake;
  readonly now: () => Date;
  readonly tickMilliseconds?: number;
}

const COMPONENT = "AutomationScheduler";

/**
 * The timer of automations (PAGE-297), running in the process that runs plans.
 *
 * @remarks
 * Every pass turns events into runs, fires due time triggers, starts waiting
 * runs whose automation has no running run, and settles runs whose work
 * happens elsewhere. A due time is moved before its run is queued, in one
 * transaction, so a restart never repeats a run: a missed once trigger runs
 * once after the start, a missed interval runs once and then keeps its
 * rhythm. Nothing here waits in the browser.
 */
export class AutomationScheduler {
  private readonly dependencies: AutomationSchedulerDependencies;
  private readonly inFlight = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;
  private isRepeatRequested = false;
  private passes = 0;

  public constructor(dependencies: AutomationSchedulerDependencies) {
    this.dependencies = dependencies;
  }

  /** Starts the passes; a second call changes nothing. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.wake(),
      this.dependencies.tickMilliseconds ?? TICK_MILLISECONDS,
    );
    this.timer.unref();
    logEvent({
      level: "info",
      event: "automation.scheduler.started",
      component: COMPONENT,
      message: "Automation scheduler started",
    });
    this.wake();
  }

  /** Runs a pass now, or right after the current one. */
  public wake(): void {
    if (this.pending) {
      this.isRepeatRequested = true;
      return;
    }
    this.pending = withBackgroundDatabaseWork("automation_scheduler", () =>
      this.pass(),
    )
      .catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      })
      .finally(() => {
        this.pending = null;
        if (this.isRepeatRequested && this.timer) {
          this.isRepeatRequested = false;
          this.wake();
        }
      });
  }

  /** Stops the passes and the scripts of this process, and waits for both. */
  public async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dependencies.executor.abortAll();
    await this.pending;
    await Promise.allSettled([...this.inFlight]);
  }

  /** One pass; each step is logged on its own failure and the others still run. */
  public async pass(): Promise<void> {
    const steps = [
      () => this.dependencies.intake.process(),
      () => this.fireDue(),
      () => this.startRuns(),
      () => this.settleRuns(),
      () => this.cleanUp(),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);
      }
    }
  }

  private async fireDue(): Promise<void> {
    const now = this.dependencies.now();
    const due = await new AutomationRepository(this.dependencies.database).due(
      now.toISOString(),
      BATCH,
    );
    for (const automation of due) await this.fire(automation.id, now);
  }

  /** Moves the due time and queues the run in one transaction. */
  private async fire(automationId: string, now: Date): Promise<void> {
    await this.dependencies.database.transaction(async (transaction) => {
      const automations = new AutomationRepository(transaction);
      const current = await automations.lock(automationId);
      if (!current?.isActive || !current.nextRunAt) return;
      if (Date.parse(current.nextRunAt) > now.getTime()) return;
      await this.advance(automations, current, now);
      await new AutomationRunRepository(transaction).enqueue({
        id: randomUUID(),
        automationId: current.id,
        triggerKind: current.trigger.type,
        eventType: null,
        triggerSubject: null,
        triggerData: null,
        requestedBy: null,
        queuedAt: now.toISOString(),
      });
    });
  }

  /** A once trigger switches its automation off and loses its time; others plan the next run. */
  private async advance(
    automations: AutomationRepository,
    current: StoredAutomation,
    now: Date,
  ): Promise<void> {
    const { trigger } = current;
    if (trigger.type === "once") {
      await automations.replace(
        {
          ...current,
          trigger: { ...trigger, at: null },
          isActive: false,
          nextRunAt: null,
          revision: current.revision + 1,
          updatedAt: now.toISOString(),
        },
        current.revision,
      );
      return;
    }
    const dueAt = new Date(current.nextRunAt ?? now.toISOString());
    await automations.schedule(current.id, nextRunAfter(trigger, dueAt, now));
  }

  private async startRuns(): Promise<void> {
    const { database, executor, now } = this.dependencies;
    const runs = new AutomationRunRepository(database);
    for (const run of await runs.startable(BATCH)) {
      if (executor.isExecuting(run.id)) continue;
      let isClaimed = false;
      try {
        isClaimed = await runs.claim(run.id, now().toISOString());
      } catch (error: unknown) {
        // Another run of the same automation started meanwhile.
        logCaughtError(COMPONENT, error);
      }
      if (!isClaimed) continue;
      this.track(executor.start({ ...run, status: "accepted" }));
    }
  }

  private async settleRuns(): Promise<void> {
    const { database, executor } = this.dependencies;
    const runs = await new AutomationRunRepository(database).open();
    for (const run of runs)
      if (!executor.isExecuting(run.id)) await executor.settle(run);
  }

  private async cleanUp(): Promise<void> {
    this.passes += 1;
    if (this.passes % CLEANUP_PASSES !== 1) return;
    const before = new Date(
      this.dependencies.now().getTime() - DELIVERY_RETENTION_MS,
    ).toISOString();
    await new AutomationAgentJobRepository(
      this.dependencies.database,
    ).pruneEnded(before);
  }

  private track(work: Promise<void>): void {
    const tracked = work
      .catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      })
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
  }
}
