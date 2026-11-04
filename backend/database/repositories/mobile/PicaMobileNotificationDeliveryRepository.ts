import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { PicaMobileNotificationEventType } from "@/definition/PicaMobileNotifications";

/** One push attempt of an event to a device, handed out for sending. */
export interface DeliveryRecord {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly deviceId: string;
  readonly accountId: string;
  readonly runId: string;
  readonly eventType: PicaMobileNotificationEventType;
  readonly seq: number;
  /** Attempts including the one that was just handed out. */
  readonly attempts: number;
  readonly expiresAt: string;
}

/** How a handed-out delivery ends. */
export type DeliveryEnd = "sent" | "failed" | "dropped" | "expired";

const DELIVERY_COLUMNS = `
    delivery_id,
    event_id,
    device_id,
    account_id,
    run_id,
    event_type,
    seq,
    attempts,
    expires_at`;

function readEventType(value: string): PicaMobileNotificationEventType {
  if (
    value === "step_started" ||
    value === "run_cancelled" ||
    value === "run_failed" ||
    value === "run_succeeded"
  ) {
    return value;
  }

  throw new Error('Database returned an invalid value for "event_type".');
}

function toDelivery(row: readonly DatabaseValue[]): DeliveryRecord {
  return {
    deliveryId: readTextColumn(row, 0, "delivery_id"),
    eventId: readTextColumn(row, 1, "event_id"),
    deviceId: readTextColumn(row, 2, "device_id"),
    accountId: readTextColumn(row, 3, "account_id"),
    runId: readTextColumn(row, 4, "run_id"),
    eventType: readEventType(readTextColumn(row, 5, "event_type")),
    seq: readCountColumn(row, 6, "seq"),
    attempts: readCountColumn(row, 7, "attempts"),
    expiresAt: readTextColumn(row, 8, "expires_at"),
  };
}

/**
 * Persistence of the outbox of Pica Mobile push attempts.
 *
 * @remarks
 * A delivery is handed out under a lock that runs out, so a crash while
 * sending leaves it to be handed out again rather than lost. A handed-out
 * delivery whose validity ends meanwhile is never sent: the dispatcher checks
 * the remaining validity before it sends.
 */
export class PicaMobileNotificationDeliveryRepository {
  private readonly database: Pick<Database, "execute" | "query">;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Pick<Database, "execute" | "query">) {
    this.database = database;
  }

  /**
   * Hands out the pending deliveries that are due and counts the attempt.
   *
   * @param now - The current moment as ISO-8601 text.
   * @param lockedUntil - When the hand-out lapses if nobody finishes it.
   * @param limit - Most deliveries to hand out.
   * @returns The deliveries, oldest first.
   */
  public async claimDue(
    now: string,
    lockedUntil: string,
    limit: number,
  ): Promise<readonly DeliveryRecord[]> {
    const rows = await this.database.query(
      `
        UPDATE pica_mobile_notification_deliveries
        SET state = 'sending',
            attempts = attempts + 1,
            locked_until = $locked_until
        WHERE delivery_id IN (
            SELECT delivery_id
            FROM pica_mobile_notification_deliveries
            WHERE state = 'pending'
                AND not_before <= $now
                AND expires_at > $now
            ORDER BY not_before ASC, seq ASC, run_id ASC, device_id ASC, delivery_id ASC
            LIMIT ${Math.trunc(limit)}
        )
        RETURNING${DELIVERY_COLUMNS};
      `,
      { locked_until: lockedUntil, now },
    );

    return rows
      .map((row) => toDelivery(row))
      .sort(
        (first, second) =>
          first.seq - second.seq ||
          first.runId.localeCompare(second.runId) ||
          first.deviceId.localeCompare(second.deviceId) ||
          first.deliveryId.localeCompare(second.deliveryId),
      );
  }

  /** Makes deliveries whose lock ran out claimable again. */
  public async releaseExpiredLocks(now: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE pica_mobile_notification_deliveries
        SET state = 'pending',
            locked_until = NULL
        WHERE state = 'sending'
            AND locked_until < $now;
      `,
      { now },
    );
  }

  /** Ends the pending deliveries whose validity is over. */
  public async expireDue(now: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE pica_mobile_notification_deliveries
        SET state = 'expired',
            outcome = 'validity_elapsed',
            finished_at = $now
        WHERE state = 'pending'
            AND expires_at <= $now;
      `,
      { now },
    );
  }

  /**
   * Ends a handed-out delivery.
   *
   * @param deliveryId - The delivery.
   * @param end - How it ended.
   * @param outcome - A short machine-readable reason; never a token or a name.
   * @param now - The current moment as ISO-8601 text.
   */
  public async finish(
    deliveryId: string,
    end: DeliveryEnd,
    outcome: string,
    now: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE pica_mobile_notification_deliveries
        SET state = $state,
            outcome = $outcome,
            locked_until = NULL,
            finished_at = $now
        WHERE delivery_id = $delivery_id
            AND state = 'sending';
      `,
      { delivery_id: deliveryId, state: end, outcome, now },
    );
  }

  /**
   * Returns a handed-out delivery to the queue for a later attempt.
   *
   * @param deliveryId - The delivery.
   * @param notBefore - Earliest next attempt as ISO-8601 text.
   * @param outcome - A short machine-readable reason.
   * @param isAttemptCounted - Whether the attempt just made counts; a mere
   * deferral for throttling does not.
   */
  public async requeue(
    deliveryId: string,
    notBefore: string,
    outcome: string,
    isAttemptCounted: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE pica_mobile_notification_deliveries
        SET state = 'pending',
            attempts = CASE WHEN $is_counted THEN attempts ELSE attempts - 1 END,
            not_before = $not_before,
            outcome = $outcome,
            locked_until = NULL
        WHERE delivery_id = $delivery_id
            AND state = 'sending';
      `,
      {
        delivery_id: deliveryId,
        not_before: notBefore,
        outcome,
        is_counted: isAttemptCounted,
      },
    );
  }

  /**
   * Tells when the last step push of a run reached a device's push service.
   *
   * @param runId - The run.
   * @param deviceId - The device.
   * @returns ISO-8601 text of the moment, or `null` when none was sent.
   */
  public async lastStepPushAt(
    runId: string,
    deviceId: string,
  ): Promise<string | null> {
    const [row] = await this.database.query(
      `
        SELECT MAX(finished_at)
        FROM pica_mobile_notification_deliveries
        WHERE run_id = $run_id
            AND device_id = $device_id
            AND event_type = 'step_started'
            AND state = 'sent';
      `,
      { run_id: runId, device_id: deviceId },
    );

    return row === undefined
      ? null
      : readNullableTextColumn(row, 0, "finished_at");
  }

  /**
   * Tells whether a newer push of the same run waits for, is in, or went to a device.
   *
   * @param runId - The run.
   * @param deviceId - The device.
   * @param seq - The sequence number of the delivery that is checked.
   *
   * @remarks
   * An older progress push that comes back for a retry would otherwise be
   * shown after the newer one that replaced it.
   */
  public async hasNewerDelivery(
    runId: string,
    deviceId: string,
    seq: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT 1
        FROM pica_mobile_notification_deliveries
        WHERE run_id = $run_id
            AND device_id = $device_id
            AND seq > $seq
            AND state IN ('pending', 'sending', 'sent');
      `,
      { run_id: runId, device_id: deviceId, seq },
    );

    return rows.length > 0;
  }

  /**
   * Tells when work on the outbox is next due.
   *
   * @returns ISO-8601 text: when the next pending delivery may be sent, or
   * when the lock of a handed-out one runs out. `null` when nothing is open.
   */
  public async nextDueAt(): Promise<string | null> {
    const [row] = await this.database.query(
      `
        SELECT MIN(
            CASE WHEN state = 'pending' THEN not_before ELSE locked_until END
        )
        FROM pica_mobile_notification_deliveries
        WHERE state IN ('pending', 'sending');
      `,
    );

    return row === undefined
      ? null
      : readNullableTextColumn(row, 0, "next_due_at");
  }
}
