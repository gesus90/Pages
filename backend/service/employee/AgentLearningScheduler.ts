import { logCaughtError } from "@/backend/logging/Logger";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentLearningService } from "./AgentLearningService";

/** How often the scheduler looks for due learning runs. */
const TICK_MILLISECONDS = 60_000;

/**
 * Starts the due dream runs of agent employees (PAGE-305, PAGE-378): every
 * agent dreams on its own schedule, from every hour to every 30 days (by
 * default daily at the time set under Einstellungen → Agents, 03:00), and a
 * run somebody asked for follows once the agent works in no chat. A run that
 * is due while the agent works in a chat is not started and is looked at
 * again on the next tick. One agent after the other.
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
        if (await this.learning.isDue(agent))
          await this.learning.run(agent.userId, {
            trigger: agent.dreamRequest?.trigger ?? "schedule",
          });
    } catch (error: unknown) {
      logCaughtError("AgentLearningScheduler", error);
    }
  }
}
