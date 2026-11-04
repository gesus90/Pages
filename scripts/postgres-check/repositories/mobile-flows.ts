import {
  createNotificationEventId,
  PicaMobileNotificationEventRepository,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";

import {
  ACCOUNT,
  OTHER_ACCOUNT,
  OUTBOX_STATE,
  outboxRow,
} from "./mobile-fixtures";
import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type {
  DeliveryEnd,
  DeliveryRecord,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import type {
  NewNotificationEvent,
  StoredEventStep,
  StoredNotificationEvent,
} from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";

const T1 = "2026-03-01T08:00:00.000Z";
const T2 = "2026-03-01T09:00:00.000Z";
const T3 = "2026-03-01T10:00:00.000Z";
const T4 = "2026-03-01T11:00:00.000Z";
const T5 = "2026-03-01T12:00:00.000Z";

const STEP: StoredEventStep = {
  instanceId: "step-1:1",
  stepId: "step-1",
  loopId: null,
  number: 1,
  attempt: 1,
  iteration: null,
};

const EVENT: NewNotificationEvent = {
  accountId: ACCOUNT,
  planId: "plan-mobile",
  runId: "run-mobile",
  type: "step_started",
  occurredAt: T1,
  candidates: [{ key: "step-1", steps: [STEP] }],
  reason: null,
  deviceIds: ["device-b", "device-a"],
  expiresAt: T4,
};

function events({
  database,
}: RepositoryWorld): PicaMobileNotificationEventRepository {
  return new PicaMobileNotificationEventRepository(database);
}

function deliveries({
  database,
}: RepositoryWorld): PicaMobileNotificationDeliveryRepository {
  return new PicaMobileNotificationDeliveryRepository(database);
}

/** The identifier of an event is random and not a UUID, so it is taken out of a comparison. */
function withoutEventId(
  event: StoredNotificationEvent | null,
): StoredNotificationEvent | null {
  return event === null ? null : { ...event, eventId: "<event>" };
}

function withoutEventIds(
  records: readonly DeliveryRecord[],
): readonly DeliveryRecord[] {
  return records.map((record) => ({ ...record, eventId: "<event>" }));
}

async function deliveryId(
  { database }: RepositoryWorld,
  key: {
    readonly runId: string;
    readonly deviceId: string;
    readonly seq: number;
  },
): Promise<string> {
  const [row] = await database.query(
    `
    SELECT delivery_id
    FROM pica_mobile_notification_deliveries
    WHERE run_id = $run_id
        AND device_id = $device_id
        AND seq = $seq;
  `,
    { run_id: key.runId, device_id: key.deviceId, seq: key.seq },
  );
  const id = row?.[0];
  if (typeof id !== "string") throw new Error("The flow ends without the row.");
  return id;
}

async function eventIdOf(
  { database }: RepositoryWorld,
  runId: string,
  seq: number,
): Promise<string> {
  const [row] = await database.query(
    `
    SELECT event_id
    FROM pica_mobile_notification_events
    WHERE run_id = $run_id
        AND seq = $seq;
  `,
    { run_id: runId, seq },
  );
  const id = row?.[0];
  if (typeof id !== "string") throw new Error("The flow ends without the row.");
  return id;
}

/** Events of a run: announced once, numbered, with their pushes, and the cleanup. */
export const MOBILE_EVENT_FLOW: RepositoryFlow = {
  title: "mobile events",
  steps: [
    call("createNotificationEventId", () =>
      Promise.resolve(/^[\w-]{22}$/u.test(createNotificationEventId())),
    ),
    refused("PicaMobileNotificationEventRepository.readInstanceId", (world) =>
      events(world).readInstanceId(MISSING_TEXT),
    ),
    call("PicaMobileNotificationEventRepository.readInstanceId", (world) =>
      events(world).readInstanceId("instance-first"),
    ),
    call("PicaMobileNotificationEventRepository.readInstanceId", (world) =>
      events(world).readInstanceId("instance-second"),
    ),
    call("PicaMobileNotificationEventRepository.find", (world) =>
      events(world).find("event-unknown"),
    ),
    call("PicaMobileNotificationEventRepository.record", async (world) =>
      withoutEventId(await events(world).record(EVENT, T1)),
    ),
    call("PicaMobileNotificationEventRepository.record", async (world) =>
      withoutEventId(await events(world).record(EVENT, T1)),
    ),
    call("PicaMobileNotificationEventRepository.record", async (world) =>
      withoutEventId(
        await events(world).record({ ...EVENT, candidates: [] }, T1),
      ),
    ),
    call("PicaMobileNotificationEventRepository.find", async (world) =>
      withoutEventId(
        await events(world).find(await eventIdOf(world, "run-mobile", 1)),
      ),
    ),
    stored(`
      SELECT
          device_id,
          event_type,
          seq,
          state,
          attempts,
          not_before,
          expires_at,
          created_at
      FROM pica_mobile_notification_deliveries
      WHERE run_id = 'run-mobile'
      ORDER BY seq, device_id;
    `),
    // A new step replaces the waiting pushes of the older one.
    call("PicaMobileNotificationEventRepository.record", async (world) =>
      withoutEventId(
        await events(world).record(
          {
            ...EVENT,
            occurredAt: T2,
            candidates: [
              { key: "step-1", steps: [STEP] },
              {
                key: "step-2",
                steps: Array.from({ length: 25 }, (_, index) => ({
                  ...STEP,
                  instanceId: `step-2:${String(index)}`,
                  stepId: "step-2",
                  loopId: "loop-1",
                  iteration: index,
                })),
              },
              { key: "step-2", steps: [STEP] },
            ],
            deviceIds: ["device-a"],
          },
          T2,
        ),
      ),
    ),
    refused("PicaMobileNotificationEventRepository.record", (world) =>
      events(world).record(
        {
          ...EVENT,
          occurredAt: MISSING_TEXT,
          candidates: [{ key: "step-3", steps: [STEP] }],
        },
        T3,
      ),
    ),
    stored(`
      SELECT
          (SELECT COUNT(*) FROM pica_mobile_notification_occurrences WHERE occurrence_key = 'step-3'),
          (SELECT last_seq FROM pica_mobile_notification_sequences WHERE run_id = 'run-mobile');
    `),
    call("PicaMobileNotificationEventRepository.record", async (world) =>
      withoutEventId(
        await events(world).record(
          {
            ...EVENT,
            type: "run_failed",
            occurredAt: T3,
            candidates: [{ key: "end", steps: [] }],
            reason: "provider_error",
            deviceIds: ["device-b"],
          },
          T3,
        ),
      ),
    ),
    stored(`
      SELECT
          device_id,
          event_type,
          seq,
          state,
          outcome,
          finished_at
      FROM pica_mobile_notification_deliveries
      WHERE run_id = 'run-mobile'
      ORDER BY seq, device_id;
    `),
    prepare(`
      UPDATE pica_mobile_notification_events
      SET steps_json = '{}'
      WHERE run_id = 'run-mobile'
          AND seq = 2;
    `),
    refused("PicaMobileNotificationEventRepository.find", async (world) =>
      events(world).find(await eventIdOf(world, "run-mobile", 2)),
    ),
    prepare(`
      INSERT INTO pica_mobile_notification_events (
          event_id, account_id, plan_id, run_id, seq, event_type, occurred_at, reason
      )
      VALUES
          ('tie-z', '${OTHER_ACCOUNT}', 'plan', 'run-tie-a', 1, 'run_failed', '${T5}', 'keep-a'),
          ('tie-y', '${OTHER_ACCOUNT}', 'plan', 'run-tie-c', 1, 'run_failed', '${T5}', 'keep-c'),
          ('tie-x', '${OTHER_ACCOUNT}', 'plan', 'run-tie-b', 1, 'run_failed', '${T5}', 'keep-b');
    `),
    prepare(`
      INSERT INTO pica_mobile_notification_occurrences (run_id, occurrence_key, event_id, created_at)
      VALUES
          ('run-tie-a', 'old', 'tie-z', '${T1}'),
          ('run-tie-a', 'new', 'tie-z', '${T5}');
    `),
    prepare(`
      INSERT INTO pica_mobile_notification_sequences (run_id, last_seq)
      VALUES ('run-gone', 7);
    `),
    prepare(`
      INSERT INTO pica_mobile_notification_sequences (run_id, last_seq)
      SELECT
          id,
          3
      FROM agent_plan_runs;
    `),
    reversedInPostgres("pica_mobile_notification_events"),
    call("PicaMobileNotificationEventRepository.prune", (world) =>
      events(world).prune({
        eventsBefore: T1,
        deliveriesBefore: T1,
        maximumEventsPerAccount: 2,
      }),
    ),
    stored(`
      SELECT
          run_id,
          seq,
          reason
      FROM pica_mobile_notification_events
      ORDER BY run_id, seq;
    `),
    stored(`
      SELECT
          device_id,
          seq,
          state
      FROM pica_mobile_notification_deliveries
      WHERE run_id = 'run-mobile'
      ORDER BY seq, device_id;
    `),
    call("PicaMobileNotificationEventRepository.prune", (world) =>
      events(world).prune({
        eventsBefore: T2,
        deliveriesBefore: T5,
        maximumEventsPerAccount: 100,
      }),
    ),
    stored(`
      SELECT
          run_id,
          seq
      FROM pica_mobile_notification_events
      ORDER BY run_id, seq;
    `),
    stored(`
      SELECT
          run_id,
          occurrence_key
      FROM pica_mobile_notification_occurrences
      ORDER BY run_id, occurrence_key;
    `),
    stored(`
      SELECT
          device_id,
          seq,
          state
      FROM pica_mobile_notification_deliveries
      WHERE run_id = 'run-mobile'
      ORDER BY seq, device_id;
    `),
    stored(
      "SELECT run_id FROM pica_mobile_notification_sequences ORDER BY run_id;",
    ),
    refusedWithoutTable(
      "PicaMobileNotificationEventRepository.prune",
      "agent_plan_runs",
      (transaction) =>
        new PicaMobileNotificationEventRepository({
          ...transaction,
          transaction: (work) => work(transaction),
        }).prune({
          eventsBefore: T1,
          deliveriesBefore: T1,
          maximumEventsPerAccount: 100,
        }),
    ),
    prepare("DELETE FROM pica_mobile_notification_deliveries;"),
    prepare("DELETE FROM pica_mobile_notification_events;"),
    prepare("DELETE FROM pica_mobile_notification_occurrences;"),
    prepare("DELETE FROM pica_mobile_notification_sequences;"),
  ],
};

/** The outbox of pushes: handing out, ending, retrying and what is due next. */
export const MOBILE_DELIVERY_FLOW: RepositoryFlow = {
  title: "mobile deliveries",
  steps: [
    call("PicaMobileNotificationDeliveryRepository.nextDueAt", (world) =>
      deliveries(world).nextDueAt(),
    ),
    call("PicaMobileNotificationDeliveryRepository.lastStepPushAt", (world) =>
      deliveries(world).lastStepPushAt("run-a", "device-a"),
    ),
    call("PicaMobileNotificationDeliveryRepository.claimDue", async (world) =>
      withoutEventIds(await deliveries(world).claimDue(T1, T2, 5)),
    ),
    ...[
      { runId: "run-b", deviceId: "device-b", seq: 1 },
      { runId: "run-b", deviceId: "device-a", seq: 1 },
      { runId: "run-a", deviceId: "device-b", seq: 1 },
      { runId: "run-a", deviceId: "device-a", seq: 2 },
      { runId: "run-a", deviceId: "device-a", seq: 1 },
    ].map((key) => outboxRow(key, { notBefore: T1, expiresAt: T5 })),
    outboxRow(
      { runId: "run-later", deviceId: "device-a", seq: 1 },
      { notBefore: T4, expiresAt: T5 },
    ),
    outboxRow(
      { runId: "run-ended", deviceId: "device-a", seq: 1 },
      { notBefore: T1, expiresAt: T2 },
    ),
    call("PicaMobileNotificationDeliveryRepository.nextDueAt", (world) =>
      deliveries(world).nextDueAt(),
    ),
    reversedInPostgres("pica_mobile_notification_deliveries"),
    call("PicaMobileNotificationDeliveryRepository.claimDue", async (world) =>
      withoutEventIds(await deliveries(world).claimDue(T3, T4, 3)),
    ),
    reversedInPostgres("pica_mobile_notification_deliveries"),
    call("PicaMobileNotificationDeliveryRepository.claimDue", async (world) =>
      withoutEventIds(await deliveries(world).claimDue(T3, T4, 1)),
    ),
    OUTBOX_STATE,
    call("PicaMobileNotificationDeliveryRepository.expireDue", (world) =>
      deliveries(world).expireDue(T3),
    ),
    OUTBOX_STATE,
    call("PicaMobileNotificationDeliveryRepository.nextDueAt", (world) =>
      deliveries(world).nextDueAt(),
    ),
    call("PicaMobileNotificationDeliveryRepository.finish", async (world) =>
      deliveries(world).finish(
        await deliveryId(world, {
          runId: "run-a",
          deviceId: "device-a",
          seq: 1,
        }),
        "sent",
        "accepted",
        T3,
      ),
    ),
    call("PicaMobileNotificationDeliveryRepository.finish", async (world) =>
      deliveries(world).finish(
        await deliveryId(world, {
          runId: "run-a",
          deviceId: "device-a",
          seq: 1,
        }),
        "failed",
        "too_late",
        T4,
      ),
    ),
    call("PicaMobileNotificationDeliveryRepository.lastStepPushAt", (world) =>
      deliveries(world).lastStepPushAt("run-a", "device-a"),
    ),
    call("PicaMobileNotificationDeliveryRepository.lastStepPushAt", (world) =>
      deliveries(world).lastStepPushAt("run-a", "device-b"),
    ),
    refused("PicaMobileNotificationDeliveryRepository.finish", async (world) =>
      deliveries(world).finish(
        await deliveryId(world, {
          runId: "run-a",
          deviceId: "device-b",
          seq: 1,
        }),
        "unbekannt" as DeliveryEnd,
        "x",
        T3,
      ),
    ),
    refused("PicaMobileNotificationDeliveryRepository.finish", async (world) =>
      deliveries(world).finish(
        await deliveryId(world, {
          runId: "run-a",
          deviceId: "device-b",
          seq: 1,
        }),
        MISSING_TEXT as DeliveryEnd,
        "x",
        T3,
      ),
    ),
    call("PicaMobileNotificationDeliveryRepository.requeue", async (world) =>
      deliveries(world).requeue(
        await deliveryId(world, {
          runId: "run-b",
          deviceId: "device-a",
          seq: 1,
        }),
        T4,
        "server_busy",
        true,
      ),
    ),
    call("PicaMobileNotificationDeliveryRepository.requeue", async (world) =>
      deliveries(world).requeue(
        await deliveryId(world, {
          runId: "run-a",
          deviceId: "device-b",
          seq: 1,
        }),
        T4,
        "throttled",
        false,
      ),
    ),
    OUTBOX_STATE,
    call("PicaMobileNotificationDeliveryRepository.hasNewerDelivery", (world) =>
      deliveries(world).hasNewerDelivery("run-a", "device-a", 1),
    ),
    call("PicaMobileNotificationDeliveryRepository.hasNewerDelivery", (world) =>
      deliveries(world).hasNewerDelivery("run-a", "device-a", 2),
    ),
    call("PicaMobileNotificationDeliveryRepository.hasNewerDelivery", (world) =>
      deliveries(world).hasNewerDelivery("run-unknown", "device-a", 0),
    ),
    call(
      "PicaMobileNotificationDeliveryRepository.releaseExpiredLocks",
      (world) => deliveries(world).releaseExpiredLocks(T4),
    ),
    OUTBOX_STATE,
    call(
      "PicaMobileNotificationDeliveryRepository.releaseExpiredLocks",
      (world) => deliveries(world).releaseExpiredLocks(T5),
    ),
    OUTBOX_STATE,
    call("PicaMobileNotificationDeliveryRepository.nextDueAt", (world) =>
      deliveries(world).nextDueAt(),
    ),
    prepare(`
      INSERT INTO pica_mobile_notification_deliveries (
          delivery_id, event_id, device_id, account_id, run_id, event_type, seq,
          state, attempts, not_before, expires_at, created_at
      )
      VALUES (
          'outbox-invalid', 'event-outbox', 'device-a', '${ACCOUNT}', 'run-invalid', 'unbekannt', 1,
          'pending', 0, '${T1}', '${T5}', '${T1}'
      );
    `),
    refused("PicaMobileNotificationDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T4, T5, 100),
    ),
    prepare("DELETE FROM pica_mobile_notification_deliveries;"),
  ],
};
