import { expect, it, vi } from "vitest";

import { PicaMobileNotificationDeliveryRepository } from "./PicaMobileNotificationDeliveryRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: DatabaseValue[][] = []): {
  repository: PicaMobileNotificationDeliveryRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const executor = { query, execute };

  return {
    repository: new PicaMobileNotificationDeliveryRepository(executor),
    query,
    execute,
  };
}

function deliveryRow(
  id: string,
  seq: number,
  order: number,
  type = "step_started",
): DatabaseValue[] {
  return [id, "e1", "d1", "a1", "r1", type, seq, 1n, "2026-02-01", order];
}

it("hands out due deliveries ordered by sequence and creation", async () => {
  const { repository, query } = doubleOf([
    deliveryRow("x3", 2, 1),
    deliveryRow("x2", 1, 5),
    deliveryRow("x1", 1, 2, "run_cancelled"),
  ]);

  const claimed = await repository.claimDue("now", "later", 2.9);

  expect(claimed.map((entry) => entry.deliveryId)).toEqual(["x1", "x2", "x3"]);
  expect(claimed[0]).toEqual({
    deliveryId: "x1",
    eventId: "e1",
    deviceId: "d1",
    accountId: "a1",
    runId: "r1",
    eventType: "run_cancelled",
    seq: 1,
    attempts: 1,
    expiresAt: "2026-02-01",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    locked_until: "later",
    now: "now",
    limit: 2,
  });
});

it("hands out at least one delivery", async () => {
  const { repository, query } = doubleOf();

  await repository.claimDue("now", "later", 0);

  expect(query.mock.calls[0]?.[1]).toMatchObject({ limit: 1 });
});

it.each(["run_failed", "run_succeeded"])(
  "accepts the type %s",
  async (type) => {
    const { repository } = doubleOf([deliveryRow("x", 1, 1, type)]);

    await expect(repository.claimDue("n", "l", 1)).resolves.toHaveLength(1);
  },
);

it("rejects an unknown event type", async () => {
  const { repository } = doubleOf([deliveryRow("x", 1, 1, "bogus")]);

  await expect(repository.claimDue("n", "l", 1)).rejects.toThrow("event_type");
});

it("releases locks, expires and finishes deliveries", async () => {
  const { repository, execute } = doubleOf();

  await repository.releaseExpiredLocks("now");
  await repository.expireDue("now");
  await repository.finish("x", "sent", "ok", "now");

  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { now: "now" },
    { now: "now" },
    { delivery_id: "x", state: "sent", outcome: "ok", now: "now" },
  ]);
});

it("requeues a delivery", async () => {
  const { repository, execute } = doubleOf();

  await repository.requeue("x", "later", "throttled", false);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    delivery_id: "x",
    not_before: "later",
    outcome: "throttled",
    is_counted: false,
  });
});

it("tells the last step push", async () => {
  const sent = doubleOf([["2026-01-01"]]);
  const none = doubleOf([[null]]);
  const missing = doubleOf();

  await expect(sent.repository.lastStepPushAt("r", "d")).resolves.toBe(
    "2026-01-01",
  );
  await expect(none.repository.lastStepPushAt("r", "d")).resolves.toBeNull();
  await expect(missing.repository.lastStepPushAt("r", "d")).resolves.toBeNull();
});

it("tells whether a newer delivery exists", async () => {
  await expect(
    doubleOf([[1]]).repository.hasNewerDelivery("r", "d", 1),
  ).resolves.toBe(true);
  await expect(
    doubleOf().repository.hasNewerDelivery("r", "d", 1),
  ).resolves.toBe(false);
});

it("tells when work is next due", async () => {
  await expect(doubleOf([["t"]]).repository.nextDueAt()).resolves.toBe("t");
  await expect(doubleOf().repository.nextDueAt()).resolves.toBeNull();
});
