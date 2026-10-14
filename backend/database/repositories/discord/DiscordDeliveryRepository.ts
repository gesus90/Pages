import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isDiscordEventType } from "@/definition/Discord";

import type { DatabaseValue } from "@/backend/database/Database";
import type { DiscordDatabase } from "@/backend/database/repositories/discord/DiscordDatabase";
import type {
  DiscordDeliverySummary,
  DiscordEventType,
  DiscordProblem,
} from "@/definition/Discord";

/** A stored message waiting for its delivery to Discord. */
export interface DiscordDeliveryRecord {
  readonly id: string;
  readonly projectId: string;
  readonly eventType: DiscordEventType;
  readonly contentJson: string;
  /** Attempts that failed so far; waiting for a rate limit does not count. */
  readonly attempts: number;
  readonly createdAt: string;
}

/** What a committed Pages change writes to the outbox. */
export interface NewDiscordDelivery {
  readonly id: string;
  readonly projectId: string;
  readonly eventType: DiscordEventType;
  /** The Pages path of the ticket or milestone the message is about. */
  readonly subjectKey: string;
  readonly contentJson: string;
  readonly now: string;
}

/** When and why a delivery is tried again. */
export interface DiscordDeliveryRetry {
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly problem: DiscordProblem | null;
  readonly now: string;
}

/** The persistence the Discord services use for the outbox. */
export interface DiscordDeliveryStore {
  /**
   * Writes one message to the outbox, due immediately.
   *
   * @remarks
   * While a message about the same ticket or milestone still waits, a change
   * is merged into it instead of adding a second one: the waiting message
   * keeps its event and takes over the newest facts. An update never
   * announces more than the message that is already on its way.
   */
  enqueueDelivery(delivery: NewDiscordDelivery): Promise<void>;
  /**
   * Hands out the pending deliveries that are due and locks them.
   *
   * @returns The claimed deliveries, oldest first.
   */
  claimDue(
    now: string,
    lockedUntil: string,
    limit: number,
  ): Promise<readonly DiscordDeliveryRecord[]>;
  /** Makes deliveries whose lock ran out claimable again, for example after a crash. */
  releaseExpiredLocks(now: string): Promise<void>;
  markSent(id: string, now: string): Promise<void>;
  /** Drops a message that is not wanted any more. */
  discard(id: string): Promise<void>;
  reschedule(id: string, retry: DiscordDeliveryRetry): Promise<void>;
  markFailed(
    id: string,
    failure: {
      readonly attempts: number;
      readonly problem: DiscordProblem;
      readonly now: string;
    },
  ): Promise<void>;
  summarize(projectId: string): Promise<DiscordDeliverySummary>;
  /** Removes finished deliveries that are older than the given times. */
  purge(cutoffs: {
    readonly sentBefore: string;
    readonly failedBefore: string;
  }): Promise<void>;
}

const DELIVERY_COLUMNS = `
            id,
            project_id,
            event_type,
            content_json,
            attempts,
            created_at`;

const PROBLEMS: readonly DiscordProblem[] = [
  "invalid_credentials",
  "bot_removed",
  "missing_access",
  "missing_permissions",
  "channel_missing",
  "rate_limited",
  "unavailable",
  "unknown",
];

function toProblem(value: string | null): DiscordProblem | null {
  if (value === null) {
    return null;
  }

  return PROBLEMS.find((candidate) => candidate === value) ?? "unknown";
}

/** A change is merged into a waiting message of the same event or into any waiting message when it is an update. */
function mergesInto(
  waitingEvent: string,
  delivery: Pick<NewDiscordDelivery, "eventType">,
): boolean {
  return (
    waitingEvent === delivery.eventType ||
    delivery.eventType.endsWith(".updated")
  );
}

const INSERT_DELIVERY = `
  INSERT INTO discord_deliveries (
      id,
      project_id,
      event_type,
      subject_key,
      content_json,
      status,
      attempts,
      next_attempt_at,
      created_at,
      updated_at
  )
  VALUES (
      $id,
      $project_id,
      $event_type,
      $subject_key,
      $content_json,
      'pending',
      0,
      $now,
      $now,
      $now
  );
`;

function toDelivery(row: readonly DatabaseValue[]): DiscordDeliveryRecord {
  const eventType = readTextColumn(row, 2, "event_type");

  if (!isDiscordEventType(eventType)) {
    throw new Error('Database returned an invalid value for "event_type".');
  }

  return {
    attempts: readCountColumn(row, 4, "attempts"),
    contentJson: readTextColumn(row, 3, "content_json"),
    createdAt: readTextColumn(row, 5, "created_at"),
    eventType,
    id: readTextColumn(row, 0, "id"),
    projectId: readTextColumn(row, 1, "project_id"),
  };
}

/** Establishes the persistence boundary for the Discord delivery outbox. */
export class DiscordDeliveryRepository implements DiscordDeliveryStore {
  private readonly database: DiscordDatabase;

  /**
   * Creates a Discord delivery repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DiscordDatabase) {
    this.database = database;
  }

  /** Writes one message to the outbox, due immediately, or merges it into a waiting one. */
  public async enqueueDelivery(delivery: NewDiscordDelivery): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const waiting = await transaction.query(
        `
          SELECT
              id,
              event_type
          FROM discord_deliveries
          WHERE project_id = $project_id
              AND subject_key = $subject_key
              AND status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1;
        `,
        { project_id: delivery.projectId, subject_key: delivery.subjectKey },
      );
      const row = waiting[0];

      if (row && mergesInto(readTextColumn(row, 1, "event_type"), delivery)) {
        await transaction.execute(
          `
            UPDATE discord_deliveries
            SET
                content_json = $content_json,
                updated_at = $now
            WHERE id = $id;
          `,
          {
            content_json: delivery.contentJson,
            id: readTextColumn(row, 0, "id"),
            now: delivery.now,
          },
        );

        return;
      }

      await transaction.execute(INSERT_DELIVERY, {
        content_json: delivery.contentJson,
        event_type: delivery.eventType,
        id: delivery.id,
        now: delivery.now,
        project_id: delivery.projectId,
        subject_key: delivery.subjectKey,
      });
    });
  }

  /** Hands out the pending deliveries that are due and locks them. */
  public async claimDue(
    now: string,
    lockedUntil: string,
    limit: number,
  ): Promise<readonly DiscordDeliveryRecord[]> {
    const rows = await this.database.query(
      `
        UPDATE discord_deliveries
        SET
            status = 'sending',
            locked_until = $locked_until,
            updated_at = $now
        WHERE id IN (
            SELECT id
            FROM discord_deliveries
            WHERE status = 'pending'
                AND next_attempt_at <= $now
            ORDER BY created_at ASC
            LIMIT ${Math.trunc(limit)}
        )
        RETURNING${DELIVERY_COLUMNS};
      `,
      { locked_until: lockedUntil, now },
    );

    return rows
      .map((row) => toDelivery(row))
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }

  /** Makes deliveries whose lock ran out claimable again. */
  public async releaseExpiredLocks(now: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE discord_deliveries
        SET
            status = 'pending',
            locked_until = NULL
        WHERE status = 'sending'
            AND locked_until < $now;
      `,
      { now },
    );
  }

  /** Records that Discord accepted the message. */
  public async markSent(id: string, now: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE discord_deliveries
        SET
            status = 'sent',
            locked_until = NULL,
            last_problem = NULL,
            sent_at = $now,
            updated_at = $now
        WHERE id = $id;
      `,
      { id, now },
    );
  }

  /** Drops a message that is not wanted any more. */
  public async discard(id: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM discord_deliveries WHERE id = $id;",
      { id },
    );
  }

  /** Puts a delivery back to waiting until the given time. */
  public async reschedule(
    id: string,
    retry: DiscordDeliveryRetry,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE discord_deliveries
        SET
            status = 'pending',
            locked_until = NULL,
            attempts = $attempts,
            next_attempt_at = $next_attempt_at,
            last_problem = $last_problem,
            updated_at = $now
        WHERE id = $id;
      `,
      {
        attempts: retry.attempts,
        id,
        last_problem: retry.problem,
        next_attempt_at: retry.nextAttemptAt,
        now: retry.now,
      },
    );
  }

  /** Gives a delivery up; it stays stored for the status the interface shows. */
  public async markFailed(
    id: string,
    failure: {
      readonly attempts: number;
      readonly problem: DiscordProblem;
      readonly now: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE discord_deliveries
        SET
            status = 'failed',
            locked_until = NULL,
            attempts = $attempts,
            last_problem = $last_problem,
            updated_at = $now
        WHERE id = $id;
      `,
      {
        attempts: failure.attempts,
        id,
        last_problem: failure.problem,
        now: failure.now,
      },
    );
  }

  /** Counts the deliveries of a project and names the problem still standing. */
  public async summarize(projectId: string): Promise<DiscordDeliverySummary> {
    const counts = await this.database.query(
      `
        SELECT
            COUNT(*) FILTER (WHERE status IN ('pending', 'sending')),
            COUNT(*) FILTER (WHERE status = 'failed'),
            MAX(sent_at)
        FROM discord_deliveries
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = counts[0] ?? [0, 0, null];
    const lastSentAt = readNullableTextColumn(row, 2, "sent_at");
    const problems = await this.database.query(
      `
        SELECT
            last_problem
        FROM discord_deliveries
        WHERE project_id = $project_id
            AND last_problem IS NOT NULL
            AND status IN ('pending', 'failed')
            AND updated_at > $after
        ORDER BY updated_at DESC
        LIMIT 1;
      `,
      { after: lastSentAt ?? "", project_id: projectId },
    );
    const problemRow = problems[0];

    return {
      failed: readCountColumn(row, 1, "failed"),
      lastProblem: problemRow
        ? toProblem(readNullableTextColumn(problemRow, 0, "last_problem"))
        : null,
      lastSentAt,
      pending: readCountColumn(row, 0, "pending"),
    };
  }

  /** Removes finished deliveries that are older than the given times. */
  public async purge(cutoffs: {
    readonly sentBefore: string;
    readonly failedBefore: string;
  }): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM discord_deliveries
        WHERE (status = 'sent' AND updated_at < $sent_before)
            OR (status = 'failed' AND updated_at < $failed_before);
      `,
      {
        failed_before: cutoffs.failedBefore,
        sent_before: cutoffs.sentBefore,
      },
    );
  }
}
