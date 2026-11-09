import { logCaughtError } from "@/backend/logging/Logger";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentLearningService } from "./AgentLearningService";

/** How often the scheduler looks for due learning runs. */
const TICK_MILLISECONDS = 10 * 60_000;

/**
 * Starts the due learning runs of agent employees (PAGE-266): every agent
 * learns once per rhythm, 12 hours by default, one agent after the other.
 */
export class AgentLearningScheduler {
  private readonly store: EmployeeStore;
  private readonly learning: AgentLearningService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick: Promise<void> | null = null;

  public constructor(store: EmployeeStore, learning: AgentLearningService) {
    this.store = store;
    this.learning = learning;
  }

  /** Starts looking for due runs; a second call changes nothing. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, TICK_MILLISECONDS);
    this.timer.unref();
  }

  /** Stops looking and waits for a running look to end. */
  public async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.tick;
  }

  /** Runs every due learning run once; a run that is still going is not started twice. */
  public runDue(): Promise<void> {
    this.tick ??= this.runAll().finally(() => {
      this.tick = null;
    });
    return this.tick;
  }

  private async runAll(): Promise<void> {
    try {
      for (const agent of await this.store.employees().list())
        if (this.learning.isDue(agent)) await this.learning.run(agent.userId);
    } catch (error: unknown) {
      logCaughtError("AgentLearningScheduler", error);
    }
  }
}
