import { logEvent } from "@/backend/logging/Logger";

import type { RunnerHistoryRecoveryRepository } from "@/backend/database/repositories/runner/RunnerHistoryRecoveryRepository";

/** Drains ordered history outside the runner control queue, including after the last terminal packet. */
export class RunnerHistoryRecovery {
  private readonly repository: RunnerHistoryRecoveryRepository;
  private readonly active = new Map<string, Promise<void>>();
  private readonly retries = new Map<string, NodeJS.Timeout>();

  public constructor(repository: RunnerHistoryRecoveryRepository) {
    this.repository = repository;
    void this.resume();
  }

  /** Shares each connection's current import and retries failures without blocking another connection. */
  public async restore(connectionId: string): Promise<void> {
    const running = this.active.get(connectionId);
    if (running) return running;
    clearTimeout(this.retries.get(connectionId));
    this.retries.delete(connectionId);
    const pending = this.drain(connectionId).finally(() => {
      this.active.delete(connectionId);
    });
    this.active.set(connectionId, pending);
    return pending;
  }

  private async resume(): Promise<void> {
    try {
      for (const connectionId of await this.repository.pendingConnections())
        void this.restore(connectionId);
    } catch {
      logEvent({
        level: "error",
        event: "runner.history.recovery_start_failed",
        component: "RunnerHistoryRecovery",
        message:
          "Retained history recovery could not start; inspect database availability",
      });
    }
  }

  private async drain(connectionId: string): Promise<void> {
    let delay = 30_000;
    try {
      const count = await this.repository.restore(connectionId);
      if (!(await this.repository.hasPending(connectionId))) return;
      if (count > 0) delay = 250;
    } catch {
      logEvent({
        level: "error",
        event: "runner.history.recovery_retry",
        component: "RunnerHistoryRecovery",
        message:
          "Durable history recovery will retry independently of execution control",
        metadata: { connectionId },
      });
    }
    const timer = setTimeout(() => void this.restore(connectionId), delay);
    timer.unref();
    this.retries.set(connectionId, timer);
  }
}
