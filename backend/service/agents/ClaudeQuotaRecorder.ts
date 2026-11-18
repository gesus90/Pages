import { logCaughtError } from "@/backend/logging/Logger";

import type { ClaudeQuotaSink } from "@/backend/agents/acp/ClaudeAcpQuota";
import type { ClaudeQuotaRepository } from "@/backend/database/repositories/agent/ClaudeQuotaRepository";

/**
 * Stores the subscription figures Claude sessions report, per connection.
 * @remarks
 * A session only hands its figures over; a failed write is logged and never
 * reaches the session, because the figures are shown, never decided upon.
 */
export class ClaudeQuotaRecorder {
  private readonly repository: Pick<
    ClaudeQuotaRepository,
    "saveWindow" | "savePlan"
  >;
  private readonly clock: () => Date;

  public constructor(
    repository: Pick<ClaudeQuotaRepository, "saveWindow" | "savePlan">,
    clock: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.clock = clock;
  }

  /**
   * The sink of the sessions of one connection.
   * @param connectionId - The connection the session runs with.
   * @returns A sink that stores every reading under this connection.
   */
  public sinkFor(connectionId: string): ClaudeQuotaSink {
    return {
      recordWindow: (window) => {
        void this.store(() =>
          this.repository.saveWindow(
            connectionId,
            window,
            this.clock().toISOString(),
          ),
        );
      },
      recordPlan: (plan) => {
        void this.store(() =>
          this.repository.savePlan(
            connectionId,
            plan,
            this.clock().toISOString(),
          ),
        );
      },
    };
  }

  private async store(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error: unknown) {
      logCaughtError("ClaudeQuotaRecorder", error);
    }
  }
}
