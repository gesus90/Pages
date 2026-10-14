import { createHash } from "node:crypto";

import {
  buildNotificationMessage,
  parseNotificationContent,
} from "@/backend/discord/DiscordMessage";

import type { DiscordConnectionStore } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type {
  DiscordDeliveryRecord,
  DiscordDeliveryStore,
} from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import type { DiscordApiClient } from "@/backend/discord/DiscordApiClient";
import type { DiscordFailure } from "@/backend/discord/DiscordApiClient";
import type { DiscordAttemptStore } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import type { DiscordProblem } from "@/definition/Discord";

/** Attempts that may fail before a message is given up. */
export const MAXIMUM_DELIVERY_ATTEMPTS = 6;

/** Seconds to wait after the first, second, ... failed attempt. */
const RETRY_DELAYS_SECONDS = [30, 120, 600, 1_800, 7_200] as const;

/** A message older than this is not worth sending any more, whatever delayed it. */
const MAXIMUM_DELIVERY_AGE_MS = 24 * 60 * 60 * 1000;

const BATCH_SIZE = 20;
const LOCK_DURATION_MS = 2 * 60 * 1000;
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const NONCE_LENGTH = 24;

/** Problems that a retry cannot fix, so the message is given up at once. */
const FINAL_PROBLEMS: ReadonlySet<DiscordProblem> = new Set([
  "invalid_credentials",
  "bot_removed",
  "channel_missing",
]);

/** What one run of the worker did. */
export interface DiscordDeliveryRunResult {
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  /** Messages dropped because their event was switched off meanwhile. */
  readonly skipped: number;
}

/** Collaborators of the delivery worker. */
export interface DiscordDeliveryWorkerDependencies {
  readonly deliveries: DiscordDeliveryStore;
  readonly connections: Pick<DiscordConnectionStore, "findConnection">;
  readonly attempts: Pick<DiscordAttemptStore, "deleteExpired">;
  readonly sender: Pick<DiscordApiClient, "createMessage">;
  readonly now?: () => Date;
}

/**
 * Derives the nonce Discord uses to recognise a repeated message.
 *
 * @param deliveryId - Identifier of the stored delivery.
 * @returns A stable text of 24 characters; the same delivery always yields the same one.
 */
export function deliveryNonce(deliveryId: string): string {
  return createHash("sha256")
    .update(deliveryId)
    .digest("base64url")
    .slice(0, NONCE_LENGTH);
}

/**
 * Delivers the stored Discord messages with a bounded number of attempts.
 *
 * @remarks
 * A rate limit moves the message to the time Discord names in `Retry-After`
 * and does not count as a failed attempt; it also pauses the whole run, since
 * the limit may apply to the bot. Other failures wait longer each time and end
 * after {@link MAXIMUM_DELIVERY_ATTEMPTS}; problems that cannot fix themselves
 * end at once. Every message carries a nonce derived from its identifier and
 * Discord enforces it, so a retry after a lost response cannot post twice.
 */
export class DiscordDeliveryWorker {
  private readonly dependencies: DiscordDeliveryWorkerDependencies;
  private readonly now: () => Date;
  private isRunning = false;

  /**
   * Creates the delivery worker.
   *
   * @param dependencies - Outbox, connection storage and Discord access.
   */
  public constructor(dependencies: DiscordDeliveryWorkerDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date());
  }

  /**
   * Sends every message that is due, one after the other and oldest first.
   *
   * @returns Counters of the run; an overlapping call does nothing.
   */
  public async runDue(): Promise<DiscordDeliveryRunResult> {
    if (this.isRunning) {
      return { failed: 0, retried: 0, sent: 0, skipped: 0 };
    }

    this.isRunning = true;

    try {
      return await this.deliverBatch();
    } finally {
      this.isRunning = false;
    }
  }

  private async deliverBatch(): Promise<DiscordDeliveryRunResult> {
    const { deliveries, attempts } = this.dependencies;
    const now = this.now();
    const isoNow = now.toISOString();

    await deliveries.releaseExpiredLocks(isoNow);
    await deliveries.purge({
      failedBefore: new Date(now.getTime() - FAILED_RETENTION_MS).toISOString(),
      sentBefore: new Date(now.getTime() - SENT_RETENTION_MS).toISOString(),
    });
    await attempts.deleteExpired(
      new Date(now.getTime() - ATTEMPT_RETENTION_MS).toISOString(),
    );

    const claimed = await deliveries.claimDue(
      isoNow,
      new Date(now.getTime() + LOCK_DURATION_MS).toISOString(),
      BATCH_SIZE,
    );
    const result = { failed: 0, retried: 0, sent: 0, skipped: 0 };

    for (const [index, delivery] of claimed.entries()) {
      const outcome = await this.deliver(delivery);

      result[outcome.kind] += 1;

      if (outcome.pauseUntil !== null) {
        await this.postpone(claimed.slice(index + 1), outcome.pauseUntil);
        break;
      }
    }

    return result;
  }

  private async deliver(delivery: DiscordDeliveryRecord): Promise<{
    readonly kind: keyof DiscordDeliveryRunResult;
    readonly pauseUntil: Date | null;
  }> {
    const { deliveries, connections, sender } = this.dependencies;
    const content = parseNotificationContent(delivery.contentJson);
    const connection = await connections.findConnection(delivery.projectId);

    if (!content || !connection) {
      return this.fail(delivery, "channel_missing");
    }

    if (!connection.events[delivery.eventType]) {
      // The event was switched off after the message was stored.
      await deliveries.discard(delivery.id);

      return { kind: "skipped", pauseUntil: null };
    }

    if (
      this.now().getTime() - Date.parse(delivery.createdAt) >
      MAXIMUM_DELIVERY_AGE_MS
    ) {
      return this.fail(delivery, "unavailable");
    }

    const result = await sender.createMessage(
      connection.channelId,
      // A merged message keeps the event it was stored for and shows the newest facts.
      buildNotificationMessage({ ...content, event: delivery.eventType }),
      deliveryNonce(delivery.id),
    );

    if (result.ok) {
      await deliveries.markSent(delivery.id, this.now().toISOString());

      return { kind: "sent", pauseUntil: null };
    }

    return this.handleFailure(delivery, result.failure);
  }

  private async handleFailure(
    delivery: DiscordDeliveryRecord,
    failure: DiscordFailure,
  ): Promise<{
    readonly kind: keyof DiscordDeliveryRunResult;
    readonly pauseUntil: Date | null;
  }> {
    const now = this.now();

    if (failure.problem === "rate_limited") {
      const resumeAt = new Date(
        now.getTime() + (failure.retryAfterSeconds ?? 1) * 1000,
      );

      await this.dependencies.deliveries.reschedule(delivery.id, {
        attempts: delivery.attempts,
        nextAttemptAt: resumeAt.toISOString(),
        now: now.toISOString(),
        problem: "rate_limited",
      });

      return { kind: "retried", pauseUntil: resumeAt };
    }

    const attempts = delivery.attempts + 1;
    const delaySeconds = RETRY_DELAYS_SECONDS[attempts - 1];

    if (FINAL_PROBLEMS.has(failure.problem) || delaySeconds === undefined) {
      return this.fail(delivery, failure.problem, attempts);
    }

    await this.dependencies.deliveries.reschedule(delivery.id, {
      attempts,
      nextAttemptAt: new Date(
        now.getTime() + delaySeconds * 1000,
      ).toISOString(),
      now: now.toISOString(),
      problem: failure.problem,
    });

    return { kind: "retried", pauseUntil: null };
  }

  private async fail(
    delivery: DiscordDeliveryRecord,
    problem: DiscordProblem,
    attempts: number = delivery.attempts + 1,
  ): Promise<{
    readonly kind: "failed";
    readonly pauseUntil: null;
  }> {
    await this.dependencies.deliveries.markFailed(delivery.id, {
      attempts,
      now: this.now().toISOString(),
      problem,
    });
    console.warn(
      `Pages gave up a Discord notification after ${attempts} attempt(s): ${problem}.`,
    );

    return { kind: "failed", pauseUntil: null };
  }

  private async postpone(
    deliveries: readonly DiscordDeliveryRecord[],
    until: Date,
  ): Promise<void> {
    for (const delivery of deliveries) {
      await this.dependencies.deliveries.reschedule(delivery.id, {
        attempts: delivery.attempts,
        nextAttemptAt: until.toISOString(),
        now: this.now().toISOString(),
        problem: "rate_limited",
      });
    }
  }
}
