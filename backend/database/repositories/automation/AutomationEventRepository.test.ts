import { expect, it, vi } from "vitest";

import { AutomationEventRepository } from "./AutomationEventRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AutomationEventRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AutomationEventRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

it("records an event with its parameters", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.record({
    eventType: "ticket.created",
    payload: "{}",
    actorId: null,
    occurredAt: "t",
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    event_type: "ticket.created",
    payload: "{}",
    actor_id: null,
    occurred_at: "t",
  });
});

it("reads events in order with bigint and number sequences", async () => {
  const { repository, query } = doubleOf([
    [1n, "plan.started", "{}", "u1", "t1"],
    [2, "plan.failed", "{}", null, "t2"],
  ]);

  const events = await repository.next(5);

  expect(events).toEqual([
    {
      sequence: 1,
      eventType: "plan.started",
      payload: "{}",
      actorId: "u1",
      occurredAt: "t1",
    },
    {
      sequence: 2,
      eventType: "plan.failed",
      payload: "{}",
      actorId: null,
      occurredAt: "t2",
    },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ limit: 5 });
});

it("skips events of an unknown type", async () => {
  const { repository } = doubleOf([[1, "unknown", "{}", null, "t"]]);

  expect(await repository.next(5)).toEqual([]);
});

it("rejects a sequence that is not numeric", async () => {
  const { repository } = doubleOf([["1", "plan.started", "{}", null, "t"]]);

  await expect(repository.next(5)).rejects.toThrow(
    'Database returned an invalid value for "sequence".',
  );
});

it("removes events through a sequence", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.remove(7);

  expect(execute.mock.calls[0]?.[1]).toEqual({ sequence: 7 });
});
