import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

const STARTUP_SETTLEMENT_WAIT_MS = 5_000;

/** Bounds startup's wait for independent native cleanup while retaining its ownership until completion. */
export class LocalFinishedSessions {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly settle: (entry: LocalSessionEntry) => Promise<void>;

  public constructor(settle: (entry: LocalSessionEntry) => Promise<void>) {
    this.settle = settle;
  }

  /** Prevents another recovery path from waiting on or replacing a background attachment. */
  public has(instanceId: string): boolean {
    return this.pending.has(instanceId);
  }

  /** Starts independent settlements together; a slow orphan never extends the overall startup budget. */
  public async start(entries: readonly LocalSessionEntry[]): Promise<void> {
    const tasks = entries.map((entry) => this.startEntry(entry));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(tasks),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            logEvent({
              level: "warn",
              event: "agent.local_owner.settlement_deferred",
              component: "LocalSessions",
              message:
                "Native cleanup continues after startup; reservations remain held until confirmed",
              metadata: { count: this.pending.size },
            });
            resolve();
          }, STARTUP_SETTLEMENT_WAIT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private startEntry(entry: LocalSessionEntry): Promise<void> {
    const previous = this.pending.get(entry.instanceId);
    if (previous) return previous;
    const task = this.settle(entry)
      .catch((error: unknown) => logCaughtError("LocalSessions", error))
      .finally(() => this.pending.delete(entry.instanceId));
    this.pending.set(entry.instanceId, task);
    return task;
  }
}
