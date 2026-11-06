import { logEvent } from "@/backend/logging/Logger";

import type {
  PagesEventOutboxReaderRepository,
  PagesEventRemovalLimits,
} from "@/backend/database/repositories/events/PagesEventOutboxReaderRepository";

/** How much retention removes and how long events stay. */
export interface PagesEventRetentionLimits extends PagesEventRemovalLimits {
  /** At most this many blocks in one run, so one run never holds the writer for long. */
  readonly maximumBatches: number;
}

/** A week of events stays readable for a reader that was away. */
const DEFAULT_LIMITS: PagesEventRetentionLimits = {
  minimumAgeSeconds: 7 * 24 * 60 * 60,
  batchSize: 500,
  maximumBatches: 40,
};

/** The outcome of one retention run. */
export interface PagesEventRetentionRun {
  readonly removed: number;
  readonly batches: number;
  readonly prunedThrough: number;
}

/**
 * Removes old outbox events in small blocks.
 *
 * @remarks
 * Each block is a transaction of its own, so other writes run between two
 * blocks. An event after the lowest stored reader position stays whatever its
 * age; a reader without a stored position learns from the floor that it has
 * to read the current state again.
 */
export class PagesEventRetention {
  private readonly repository: PagesEventOutboxReaderRepository;
  private readonly limits: PagesEventRetentionLimits;

  /**
   * Creates the retention rule.
   *
   * @param repository - Reads and removes outbox events.
   * @param limits - Age, block size and blocks per run.
   */
  public constructor(
    repository: PagesEventOutboxReaderRepository,
    limits: PagesEventRetentionLimits = DEFAULT_LIMITS,
  ) {
    this.repository = repository;
    this.limits = limits;
  }

  /**
   * Removes expired blocks until none is left or the run reached its limit.
   *
   * @returns How many events and blocks left and the floor afterwards.
   */
  public async runOnce(): Promise<PagesEventRetentionRun> {
    let removed = 0;
    let batches = 0;
    let prunedThrough = 0;
    while (batches < this.limits.maximumBatches) {
      const block = await this.repository.removeExpired(this.limits);
      prunedThrough = block.prunedThrough;
      if (block.removed === 0) break;
      removed += block.removed;
      batches += 1;
      if (block.removed < this.limits.batchSize) break;
    }
    logEvent({
      level: removed > 0 ? "info" : "debug",
      event: "pages_events.retention",
      component: "PagesEventRetention",
      message: "Expired Pages events removed",
      // Allowlisted keys of the log: removed events, blocks and the floor position.
      metadata: { deleted: removed, count: batches, sequence: prunedThrough },
    });
    return { removed, batches, prunedThrough };
  }
}
