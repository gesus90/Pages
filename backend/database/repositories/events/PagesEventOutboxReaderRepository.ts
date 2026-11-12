import {
  readCountColumn,
  readIdListColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

/** One committed event with its position in the outbox. */
export interface StoredPagesEvent {
  readonly position: number;
  readonly type: string;
  readonly id: string;
  readonly audience: {
    readonly projectId: string;
    readonly departmentIds: readonly string[];
  } | null;
  /** When the event was written, as ISO 8601 in UTC. */
  readonly createdAt: string;
}

/** The events after a position, read on one snapshot with the retention floor. */
export interface PagesEventBatch {
  readonly events: readonly StoredPagesEvent[];
  /**
   * The highest position retention removed, `0` when it removed nothing. A
   * reader whose position lies below it may have missed events and reads the
   * current state again instead of trusting the batch.
   */
  readonly prunedThrough: number;
}

/** The outcome of one retention block. */
export interface PagesEventRemoval {
  readonly removed: number;
  readonly prunedThrough: number;
}

/** What retention may remove in one block. */
export interface PagesEventRemovalLimits {
  /** Events younger than this stay. */
  readonly minimumAgeSeconds: number;
  /** At most this many events leave in one transaction. */
  readonly batchSize: number;
}

const READ_FLOOR = `
  SELECT
      COALESCE(MAX(pruned_through), 0) AS pruned_through
  FROM pages_event_outbox_floor;
`;

const READ_EVENTS = `
  SELECT
      position,
      kind,
      object_id,
      audience_project_id,
      audience_department_ids,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
  FROM pages_event_outbox
  WHERE position > $after
  ORDER BY position
  LIMIT $limit;
`;

// Every event after the lowest stored reader position stays, whatever its age.
const REMOVE_EXPIRED = `
  WITH reader_floor AS (
      SELECT
          MIN(position) AS consumed_through
      FROM pages_event_outbox_readers
  ),
  expired AS (
      SELECT
          outbox.position
      FROM pages_event_outbox AS outbox
      CROSS JOIN reader_floor
      WHERE outbox.created_at < clock_timestamp() - $minimum_age_seconds * INTERVAL '1 second'
          AND (
              reader_floor.consumed_through IS NULL
              OR outbox.position <= reader_floor.consumed_through
          )
      ORDER BY outbox.position
      LIMIT $batch_size
  ),
  removed AS (
      DELETE FROM pages_event_outbox
      WHERE position IN (SELECT position FROM expired)
      RETURNING position
  )
  SELECT
      COUNT(*) AS removed,
      COALESCE(MAX(position), 0) AS highest_removed
  FROM removed;
`;

const RAISE_FLOOR = `
  INSERT INTO pages_event_outbox_floor (
      is_single,
      pruned_through
  )
  VALUES (
      TRUE,
      $pruned_through
  )
  ON CONFLICT (is_single) DO UPDATE
  SET pruned_through = GREATEST(
      pages_event_outbox_floor.pruned_through,
      EXCLUDED.pruned_through
  );
`;

function readPosition(row: readonly DatabaseValue[], index: number): number {
  return readCountColumn(row, index, "position");
}

function toStoredEvent(row: readonly DatabaseValue[]): StoredPagesEvent {
  const projectId = readNullableTextColumn(row, 3, "audience_project_id");
  return {
    position: readPosition(row, 0),
    type: readTextColumn(row, 1, "kind"),
    id: readTextColumn(row, 2, "object_id"),
    audience:
      projectId === null
        ? null
        : {
            projectId,
            departmentIds: readIdListColumn(row, 4, "audience_department_ids"),
          },
    createdAt: readTextColumn(row, 5, "created_at"),
  };
}

/**
 * Reads the outbox after a stored position and removes what every reader consumed.
 *
 * @remarks
 * Positions become visible in commit order, so a reader that continues after
 * the highest position it processed misses nothing. A position may be absent
 * because its transaction rolled back; that is a gap, not a lost event.
 */
export class PagesEventOutboxReaderRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction" | "readTransaction"
  >;

  /**
   * Creates the repository.
   *
   * @param database - The open database.
   */
  public constructor(
    database: Pick<
      Database,
      "query" | "execute" | "transaction" | "readTransaction"
    >,
  ) {
    this.database = database;
  }

  /**
   * Reads committed events after a position, oldest first.
   *
   * @param after - The last position the reader processed, `0` for the start.
   * @param limit - The most events to return.
   * @returns The events and the retention floor of the same snapshot.
   */
  public async readAfter(
    after: number,
    limit: number,
  ): Promise<PagesEventBatch> {
    return this.database.readTransaction(async (snapshot) => {
      const floor = await snapshot.query(READ_FLOOR);
      const rows = await snapshot.query(READ_EVENTS, { after, limit });
      return {
        events: rows.map(toStoredEvent),
        prunedThrough: readCountColumn(floor[0] ?? [], 0, "pruned_through"),
      };
    });
  }

  /**
   * Returns the stored position of a reader.
   *
   * @param reader - Fixed name of the reader, such as `pages-core`.
   * @returns The position, or `null` when the reader never stored one.
   */
  public async findReaderPosition(reader: string): Promise<number | null> {
    const [row] = await this.database.query(
      `
        SELECT
            position
        FROM pages_event_outbox_readers
        WHERE reader = $reader;
      `,
      { reader },
    );
    return row ? readPosition(row, 0) : null;
  }

  /**
   * Stores the last position a reader processed; retention keeps what follows.
   *
   * @param reader - Fixed name of the reader, such as `pages-core`.
   * @param position - The highest position the reader processed.
   */
  public async saveReaderPosition(
    reader: string,
    position: number,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO pages_event_outbox_readers (
            reader,
            position
        )
        VALUES (
            $reader,
            $position
        )
        ON CONFLICT (reader) DO UPDATE
        SET position = EXCLUDED.position,
            updated_at = clock_timestamp();
      `,
      { reader, position },
    );
  }

  /**
   * Removes one block of expired events that every stored reader consumed.
   *
   * @param limits - Minimum age and block size.
   * @returns How many events left and the floor after the block.
   */
  public async removeExpired(
    limits: PagesEventRemovalLimits,
  ): Promise<PagesEventRemoval> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction.query(REMOVE_EXPIRED, {
        minimum_age_seconds: limits.minimumAgeSeconds,
        batch_size: limits.batchSize,
      });
      const removed = readCountColumn(row ?? [], 0, "removed");
      const highestRemoved = readCountColumn(row ?? [], 1, "highest_removed");
      if (highestRemoved > 0)
        await transaction.execute(RAISE_FLOOR, {
          pruned_through: highestRemoved,
        });
      const floor = await transaction.query(READ_FLOOR);
      return {
        removed,
        prunedThrough: readCountColumn(floor[0] ?? [], 0, "pruned_through"),
      };
    });
  }
}
