import { randomBytes, randomUUID } from "node:crypto";

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { PICA_MOBILE_NOTIFICATION_EVENT_TYPE } from "@/definition/PicaMobileNotifications";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { PicaMobileNotificationEventType } from "@/definition/PicaMobileNotifications";

/** One step instance an event names, without any name. */
export interface StoredEventStep {
  /** Identifies the step instance in the run, including the loop iteration. */
  readonly instanceId: string;
  /** The node of the step; a loop member names its own node, not the loop. */
  readonly stepId: string;
  readonly loopId: string | null;
  readonly number: number | null;
  readonly attempt: number;
  readonly iteration: number | null;
}

/** An event as it is stored. */
export interface StoredNotificationEvent {
  readonly eventId: string;
  readonly accountId: string;
  readonly planId: string;
  readonly runId: string;
  readonly seq: number;
  readonly type: PicaMobileNotificationEventType;
  readonly occurredAt: string;
  readonly steps: readonly StoredEventStep[] | null;
  readonly stepCount: number | null;
  readonly reason: string | null;
}

/** A fact of a run that may become an event, once. */
export interface EventCandidate {
  /** Unique per run and account; a key announced to the account before is not announced to it again. */
  readonly key: string;
  /** The step instances this fact announces; none for the end of a run. */
  readonly steps: readonly StoredEventStep[];
}

/** What the recorder hands over to become one event with its pushes. */
export interface NewNotificationEvent {
  readonly accountId: string;
  readonly planId: string;
  readonly runId: string;
  readonly type: PicaMobileNotificationEventType;
  readonly occurredAt: string;
  readonly candidates: readonly EventCandidate[];
  readonly reason: string | null;
  /** Devices that receive a push for the event. */
  readonly deviceIds: readonly string[];
  /** The moment the pushes stop being worth sending, as ISO-8601 text. */
  readonly expiresAt: string;
}

/** Limits of what an event keeps. */
export interface EventRetention {
  readonly eventsBefore: string;
  readonly deliveriesBefore: string;
  readonly maximumEventsPerAccount: number;
}

const EVENT_COLUMNS = `
    event_id,
    account_id,
    plan_id,
    run_id,
    seq,
    event_type,
    occurred_at,
    steps_json,
    step_count,
    reason`;

const MAXIMUM_STORED_STEPS = 20;
const MAXIMUM_STEP_COUNT = 1000;

type Executor = Pick<DatabaseTransaction, "execute" | "query">;

function readEventType(value: string): PicaMobileNotificationEventType {
  for (const type of Object.values(PICA_MOBILE_NOTIFICATION_EVENT_TYPE)) {
    if (type === value) {
      return type;
    }
  }

  throw new Error('Database returned an invalid value for "event_type".');
}

function readSteps(text: string | null): readonly StoredEventStep[] | null {
  if (text === null) {
    return null;
  }

  const parsed: unknown = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error('Database returned an invalid value for "steps_json".');
  }

  return parsed.filter(isStoredEventStep);
}

function isStoredEventStep(value: unknown): value is StoredEventStep {
  return (
    typeof value === "object" &&
    value !== null &&
    "instanceId" in value &&
    typeof value.instanceId === "string" &&
    "stepId" in value &&
    typeof value.stepId === "string"
  );
}

function toEvent(row: readonly DatabaseValue[]): StoredNotificationEvent {
  return {
    eventId: readTextColumn(row, 0, "event_id"),
    accountId: readTextColumn(row, 1, "account_id"),
    planId: readTextColumn(row, 2, "plan_id"),
    runId: readTextColumn(row, 3, "run_id"),
    seq: readCountColumn(row, 4, "seq"),
    type: readEventType(readTextColumn(row, 5, "event_type")),
    occurredAt: readTextColumn(row, 6, "occurred_at"),
    steps: readSteps(readNullableTextColumn(row, 7, "steps_json")),
    stepCount: row[8] === null ? null : readCountColumn(row, 8, "step_count"),
    reason: readNullableTextColumn(row, 9, "reason"),
  };
}

/** A fresh, unpredictable identifier: 16 random bytes, 22 URL-safe characters. */
export function createNotificationEventId(): string {
  return randomBytes(16).toString("base64url");
}

async function readFreshCandidates(
  executor: Executor,
  event: NewNotificationEvent,
): Promise<readonly EventCandidate[]> {
  const rows = await executor.query(
    `
      SELECT occurrence_key
      FROM pica_mobile_notification_occurrences
      WHERE run_id = $run_id
          AND account_id = $account_id;
    `,
    { run_id: event.runId, account_id: event.accountId },
  );
  const announced = new Set(
    rows.map((row) => readTextColumn(row, 0, "occurrence_key")),
  );
  const seen = new Set<string>();

  return event.candidates.filter((candidate) => {
    if (announced.has(candidate.key) || seen.has(candidate.key)) {
      return false;
    }

    seen.add(candidate.key);

    return true;
  });
}

async function takeNextSequence(
  executor: Executor,
  runId: string,
): Promise<number> {
  const [row] = await executor.query(
    "SELECT last_seq FROM pica_mobile_notification_sequences WHERE run_id = $run_id;",
    { run_id: runId },
  );
  const next =
    (row === undefined ? 0 : readCountColumn(row, 0, "last_seq")) + 1;

  await executor.execute(
    `
      INSERT INTO pica_mobile_notification_sequences (run_id, last_seq)
      VALUES ($run_id, $last_seq)
      ON CONFLICT (run_id) DO UPDATE SET last_seq = excluded.last_seq;
    `,
    { run_id: runId, last_seq: next },
  );

  return next;
}

async function insertEvent(
  executor: Executor,
  stored: StoredNotificationEvent,
): Promise<void> {
  await executor.execute(
    `
      INSERT INTO pica_mobile_notification_events (
          event_id,
          account_id,
          plan_id,
          run_id,
          seq,
          event_type,
          occurred_at,
          steps_json,
          step_count,
          reason
      ) VALUES (
          $event_id,
          $account_id,
          $plan_id,
          $run_id,
          $seq,
          $event_type,
          $occurred_at,
          $steps_json,
          $step_count,
          $reason
      );
    `,
    {
      event_id: stored.eventId,
      account_id: stored.accountId,
      plan_id: stored.planId,
      run_id: stored.runId,
      seq: stored.seq,
      event_type: stored.type,
      occurred_at: stored.occurredAt,
      steps_json: stored.steps === null ? null : JSON.stringify(stored.steps),
      step_count: stored.stepCount,
      reason: stored.reason,
    },
  );
}

async function insertOccurrences(
  executor: Executor,
  fresh: readonly EventCandidate[],
  stored: StoredNotificationEvent,
  now: string,
): Promise<void> {
  for (const candidate of fresh) {
    await executor.execute(
      `
        INSERT INTO pica_mobile_notification_occurrences (
            run_id,
            account_id,
            occurrence_key,
            event_id,
            created_at
        ) VALUES ($run_id, $account_id, $occurrence_key, $event_id, $created_at);
      `,
      {
        run_id: stored.runId,
        account_id: stored.accountId,
        occurrence_key: candidate.key,
        event_id: stored.eventId,
        created_at: now,
      },
    );
  }
}

/**
 * A new step event replaces the pushes of older ones that did not leave yet; a
 * terminal event ends them, because progress after the end of a run is noise.
 */
async function supersedePendingSteps(
  executor: Executor,
  stored: StoredNotificationEvent,
  now: string,
): Promise<void> {
  await executor.execute(
    `
      UPDATE pica_mobile_notification_deliveries
      SET state = 'superseded',
          outcome = 'replaced_by_newer_event',
          finished_at = $now
      WHERE run_id = $run_id
          AND account_id = $account_id
          AND event_type = 'step_started'
          AND state = 'pending';
    `,
    { run_id: stored.runId, account_id: stored.accountId, now },
  );
}

async function insertDeliveries(
  executor: Executor,
  event: NewNotificationEvent,
  stored: StoredNotificationEvent,
  now: string,
): Promise<void> {
  for (const deviceId of event.deviceIds) {
    await executor.execute(
      `
        INSERT INTO pica_mobile_notification_deliveries (
            delivery_id,
            event_id,
            device_id,
            account_id,
            run_id,
            event_type,
            seq,
            state,
            attempts,
            not_before,
            expires_at,
            created_at
        ) VALUES (
            $delivery_id,
            $event_id,
            $device_id,
            $account_id,
            $run_id,
            $event_type,
            $seq,
            'pending',
            0,
            $not_before,
            $expires_at,
            $created_at
        );
      `,
      {
        delivery_id: randomUUID(),
        event_id: stored.eventId,
        device_id: deviceId,
        account_id: stored.accountId,
        run_id: stored.runId,
        event_type: stored.type,
        seq: stored.seq,
        not_before: stored.occurredAt,
        expires_at: event.expiresAt,
        created_at: now,
      },
    );
  }
}

function toStoredEvent(
  event: NewNotificationEvent,
  fresh: readonly EventCandidate[],
  seq: number,
): StoredNotificationEvent {
  const steps = fresh.flatMap((candidate) => candidate.steps);
  const isStepEvent =
    event.type === PICA_MOBILE_NOTIFICATION_EVENT_TYPE.STEP_STARTED;

  return {
    eventId: createNotificationEventId(),
    accountId: event.accountId,
    planId: event.planId,
    runId: event.runId,
    seq,
    type: event.type,
    occurredAt: event.occurredAt,
    steps: isStepEvent ? steps.slice(0, MAXIMUM_STORED_STEPS) : null,
    stepCount: isStepEvent ? Math.min(steps.length, MAXIMUM_STEP_COUNT) : null,
    reason: event.reason,
  };
}

/**
 * Persistence of the events of Pica Mobile notifications and of their
 * identity: sequence numbers and the record of what was announced.
 *
 * @remarks
 * An event, its sequence number, the record that its facts were announced and
 * its pushes are written in one transaction, so a crash leaves either all or
 * nothing of them. Names of plans and steps are never stored.
 */
export class PicaMobileNotificationEventRepository {
  private readonly database: Pick<
    Database,
    "execute" | "query" | "transaction"
  >;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(
    database: Pick<Database, "execute" | "query" | "transaction">,
  ) {
    this.database = database;
  }

  /**
   * Returns the identifier of this Pages instance, creating it once.
   *
   * @param candidate - Identifier to store when the instance has none yet.
   */
  public async readInstanceId(candidate: string): Promise<string> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          INSERT INTO pica_mobile_notification_instance (singleton, instance_id)
          VALUES (1, $instance_id)
          ON CONFLICT (singleton) DO NOTHING;
        `,
        { instance_id: candidate },
      );

      const [row] = await transaction.query(
        "SELECT instance_id FROM pica_mobile_notification_instance WHERE singleton = 1;",
      );

      if (row === undefined) {
        throw new Error("The notification instance identifier is missing.");
      }

      return readTextColumn(row, 0, "instance_id");
    });
  }

  /**
   * Stores an event with its pushes unless all its facts were announced before.
   *
   * @param event - The facts, the devices and the end of the pushes' validity.
   * @param now - The moment of the write as ISO-8601 text.
   * @returns The stored event, or `null` when nothing in it was new.
   *
   * @remarks
   * Only facts not announced to the account before enter the event, so a
   * repeated callback creates no second event and no second push. Each
   * recipient account has its own record, so the starter and a team member
   * of the same run each get the fact once.
   */
  public async record(
    event: NewNotificationEvent,
    now: string,
  ): Promise<StoredNotificationEvent | null> {
    return this.database.transaction(async (transaction) => {
      const fresh = await readFreshCandidates(transaction, event);

      if (fresh.length === 0) {
        return null;
      }

      const stored = toStoredEvent(
        event,
        fresh,
        await takeNextSequence(transaction, event.runId),
      );

      await insertEvent(transaction, stored);
      await insertOccurrences(transaction, fresh, stored, now);
      await supersedePendingSteps(transaction, stored, now);
      await insertDeliveries(transaction, event, stored, now);

      return stored;
    });
  }

  /** Reads one event. */
  public async find(eventId: string): Promise<StoredNotificationEvent | null> {
    const [row] = await this.database.query(
      `
        SELECT${EVENT_COLUMNS}
        FROM pica_mobile_notification_events
        WHERE event_id = $event_id;
      `,
      { event_id: eventId },
    );

    return row === undefined ? null : toEvent(row);
  }

  /**
   * Removes what no longer matters: old events and their records, finished
   * pushes, and sequence numbers of runs that no longer exist.
   *
   * @param retention - How long and how much to keep.
   */
  public async prune(retention: EventRetention): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          DELETE FROM pica_mobile_notification_deliveries
          WHERE state NOT IN ('pending', 'sending')
              AND finished_at < $before;
        `,
        { before: retention.deliveriesBefore },
      );
      await transaction.execute(
        `
          DELETE FROM pica_mobile_notification_events
          WHERE occurred_at < $before
              OR event_id IN (
                  SELECT event_id
                  FROM (
                      SELECT
                          event_id,
                          ROW_NUMBER() OVER (
                              PARTITION BY account_id
                              ORDER BY occurred_at DESC, seq DESC, creation_order ASC
                          ) AS event_rank
                      FROM pica_mobile_notification_events
                  )
                  WHERE event_rank > $maximum
              );
        `,
        {
          before: retention.eventsBefore,
          maximum: retention.maximumEventsPerAccount,
        },
      );
      await transaction.execute(
        `
          DELETE FROM pica_mobile_notification_occurrences
          WHERE created_at < $before;
        `,
        { before: retention.eventsBefore },
      );
      await transaction.execute(
        `
          DELETE FROM pica_mobile_notification_sequences
          WHERE run_id NOT IN (SELECT id FROM agent_plan_runs);
        `,
      );
    });
  }
}
