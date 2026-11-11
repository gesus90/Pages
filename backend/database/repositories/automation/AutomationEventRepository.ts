import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AUTOMATION_EVENT_TYPES } from "@/definition/Automation";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AutomationEventType } from "@/definition/Automation";

/** One event of a plan or a ticket, waiting for the scheduler. */
export interface StoredAutomationEvent {
  readonly sequence: number;
  readonly eventType: AutomationEventType;
  /** The event's data as JSON. */
  readonly payload: string;
  readonly actorId: string | null;
  readonly occurredAt: string;
}

function readSequence(value: DatabaseValue | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  throw new Error('Database returned an invalid value for "sequence".');
}

function readEventRow(
  row: readonly DatabaseValue[],
): StoredAutomationEvent | null {
  const type = readTextColumn(row, 1, "event_type");
  const eventType = AUTOMATION_EVENT_TYPES.find((name) => name === type);
  if (!eventType) return null;
  return {
    sequence: readSequence(row[0]),
    eventType,
    payload: readTextColumn(row, 2, "payload"),
    actorId: readNullableTextColumn(row, 3, "actor_id"),
    occurredAt: readTextColumn(row, 4, "occurred_at"),
  };
}

/**
 * The inbox of events for automations (PAGE-297).
 *
 * @remarks
 * Ticket events are written by a trigger of the ticket table, plan events by
 * the observer of plan runs; both only while an active automation waits for
 * the event type. The scheduler reads them in order and removes them.
 */
export class AutomationEventRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  /**
   * Creates the repository.
   *
   * @param database - The database.
   */
  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Records an event when an active automation waits for its type. */
  public async record(event: {
    readonly eventType: AutomationEventType;
    readonly payload: string;
    readonly actorId: string | null;
    readonly occurredAt: string;
  }): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO automation_events (
          event_type,
          payload,
          actor_id,
          occurred_at
      )
      SELECT
          $event_type,
          $payload,
          $actor_id,
          $occurred_at
      WHERE EXISTS (
          SELECT 1
          FROM automations
          WHERE automations.is_active
              AND automations.event_type = $event_type
      );
    `,
      {
        event_type: event.eventType,
        payload: event.payload,
        actor_id: event.actorId,
        occurred_at: event.occurredAt,
      },
    );
  }

  /** The oldest waiting events. */
  public async next(limit: number): Promise<readonly StoredAutomationEvent[]> {
    const rows = await this.database.query(
      `
      SELECT
          sequence,
          event_type,
          payload,
          actor_id,
          occurred_at
      FROM automation_events
      ORDER BY sequence
      LIMIT $limit;
    `,
      { limit },
    );
    return rows
      .map(readEventRow)
      .filter((event): event is StoredAutomationEvent => event !== null);
  }

  /** Removes the processed events up to a sequence. */
  public async remove(throughSequence: number): Promise<void> {
    await this.database.execute(
      "DELETE FROM automation_events WHERE sequence <= $sequence;",
      { sequence: throughSequence },
    );
  }
}
