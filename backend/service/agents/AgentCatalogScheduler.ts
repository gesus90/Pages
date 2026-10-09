import type { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import type { AgentCatalogRefresh } from "./AgentCatalogRefresh";

/** Trusted server lifecycle worker; persisted admin settings are its only source of due work. */
export class AgentCatalogScheduler {
  private readonly repository: AgentCatalogRepository;
  private readonly refresh: AgentCatalogRefresh;
  private timer: NodeJS.Timeout | null = null;
  private pendingRun: Promise<void> | null = null;
  private isStopped = false;

  public constructor(
    repository: AgentCatalogRepository,
    refresh: AgentCatalogRefresh,
  ) {
    this.repository = repository;
    this.refresh = refresh;
  }

  /** Polls once a minute, without immediate startup requests or overlapping batches. */
  public start(): void {
    if (this.timer !== null) return;
    this.isStopped = false;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, 60_000);
    this.timer.unref();
  }

  /** Stops new work and drains the shared executor before database shutdown. */
  public async shutdown(): Promise<void> {
    this.isStopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.refresh.shutdown();
    await this.pendingRun;
  }

  /** Performs at most one due refresh; transient conflicts retry on the next tick. */
  public async runOnce(): Promise<void> {
    if (this.pendingRun !== null || this.isStopped) return;
    const operation = this.execute();
    this.pendingRun = operation;
    try {
      await operation;
    } finally {
      this.pendingRun = null;
    }
  }

  private async execute(): Promise<void> {
    try {
      const id = await this.repository.nextDue(new Date().toISOString());
      if (id !== null && !this.isStopped) await this.refresh.run(id);
    } catch {
      // Disk errors and operation conflicts must not expose provider or credential diagnostics.
      console.warn("Pages model catalog refresh could not complete.");
    }
  }
}
