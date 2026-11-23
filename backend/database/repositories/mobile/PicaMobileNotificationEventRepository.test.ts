import { expect, it, vi } from "vitest";

import {
  createNotificationEventId,
  PicaMobileNotificationEventRepository,
} from "./PicaMobileNotificationEventRepository";

import type {
  EventCandidate,
  NewNotificationEvent,
  StoredEventStep,
} from "./PicaMobileNotificationEventRepository";
import type { DatabaseValue } from "@/backend/database/Database";

type Rows = DatabaseValue[][];

/** Answers each query in order; an exhausted script answers no rows. */
function doubleOf(script: Rows[] = []): {
  repository: PicaMobileNotificationEventRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const queue = [...script];
  const query = vi.fn(async () => queue.shift() ?? []);
  const execute = vi.fn(async () => undefined);
  const executor = { query, execute };
  const database = {
    ...executor,
    transaction: async (work: (value: typeof executor) => unknown) =>
      work(executor),
  };

  return {
    repository: new PicaMobileNotificationEventRepository(
      database as unknown as ConstructorParameters<
        typeof PicaMobileNotificationEventRepository
      >[0],
    ),
    query,
    execute,
  };
}

function stepOf(instanceId: string): StoredEventStep {
  return {
    instanceId,
    stepId: "s",
    loopId: null,
    number: 1,
    attempt: 1,
    iteration: null,
  };
}

function newEvent(
  type: NewNotificationEvent["type"],
  candidates: readonly EventCandidate[],
): NewNotificationEvent {
  return {
    accountId: "a1",
    planId: "p1",
    runId: "r1",
    type,
    occurredAt: "2026-01-01",
    candidates,
    reason: null,
    deviceIds: ["d1", "d2"],
    expiresAt: "2026-01-02",
  };
}

it("creates unpredictable URL-safe event identifiers", () => {
  const identifier = createNotificationEventId();

  expect(identifier).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(createNotificationEventId()).not.toBe(identifier);
});

it("creates the instance identifier once and reads it back", async () => {
  const { repository, execute } = doubleOf([[["inst"]]]);

  await expect(repository.readInstanceId("candidate")).resolves.toBe("inst");
  expect(execute.mock.calls[0]?.[1]).toEqual({ instance_id: "candidate" });
});

it("fails when the instance identifier is missing", async () => {
  await expect(doubleOf().repository.readInstanceId("c")).rejects.toThrow(
    "missing",
  );
});

it("records a step event with fresh facts, occurrences and pushes", async () => {
  const { repository, execute } = doubleOf([[["old"]], [[4]]]);
  const steps = Array.from({ length: 25 }, (_, index) => stepOf(`i${index}`));

  const stored = await repository.record(
    newEvent("step_started", [
      { key: "old", steps: [stepOf("x")] },
      { key: "k1", steps: steps.slice(0, 13) },
      { key: "k1", steps: [stepOf("dup")] },
      { key: "k2", steps: steps.slice(13) },
    ]),
    "now",
  );

  expect(stored).toMatchObject({
    accountId: "a1",
    seq: 5,
    type: "step_started",
    stepCount: 25,
    reason: null,
  });
  expect(stored?.steps).toHaveLength(20);
  // sequence, event, two occurrences, supersede, two deliveries
  expect(execute).toHaveBeenCalledTimes(7);
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    steps_json: JSON.stringify(stored?.steps),
    step_count: 25,
  });
});

it("starts the sequence of a run at one and caps the step count", async () => {
  const { repository } = doubleOf();
  const many = Array.from({ length: 1001 }, (_, index) => stepOf(`i${index}`));

  const stored = await repository.record(
    newEvent("step_started", [{ key: "k", steps: many }]),
    "now",
  );

  expect(stored).toMatchObject({ seq: 1, stepCount: 1000 });
});

it("records a terminal event without steps", async () => {
  const { repository, execute } = doubleOf();

  const stored = await repository.record(
    { ...newEvent("run_failed", [{ key: "end", steps: [] }]), reason: "boom" },
    "now",
  );

  expect(stored).toMatchObject({
    steps: null,
    stepCount: null,
    reason: "boom",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    steps_json: null,
    step_count: null,
    reason: "boom",
  });
});

it("records nothing when every fact was announced before", async () => {
  const { repository, execute } = doubleOf([[["k"]]]);

  await expect(
    repository.record(
      newEvent("step_started", [{ key: "k", steps: [] }]),
      "now",
    ),
  ).resolves.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

const EVENT_ROW: DatabaseValue[] = [
  "e1",
  "a1",
  "p1",
  "r1",
  2,
  "step_started",
  "2026-01-01",
  JSON.stringify([
    stepOf("i1"),
    { instanceId: 3 },
    null,
    "text",
    { instanceId: "x" },
  ]),
  3,
  null,
];

it("reads a stored event and drops malformed steps", async () => {
  const { repository } = doubleOf([[EVENT_ROW]]);

  const found = await repository.find("e1");

  expect(found?.steps).toEqual([stepOf("i1")]);
  expect(found).toMatchObject({ stepCount: 3, reason: null, seq: 2 });
});

it("reads a terminal event without steps or count", async () => {
  const row = [...EVENT_ROW];
  row[5] = "run_failed";
  row[7] = null;
  row[8] = null;
  row[9] = "why";

  await expect(doubleOf([[row]]).repository.find("e1")).resolves.toMatchObject({
    type: "run_failed",
    steps: null,
    stepCount: null,
    reason: "why",
  });
});

it("returns null for an unknown event", async () => {
  await expect(doubleOf().repository.find("e1")).resolves.toBeNull();
});

it("rejects an unknown event type and non-list steps", async () => {
  const type = [...EVENT_ROW];
  type[5] = "bogus";
  const steps = [...EVENT_ROW];
  steps[7] = "{}";

  await expect(doubleOf([[type]]).repository.find("e")).rejects.toThrow(
    "event_type",
  );
  await expect(doubleOf([[steps]]).repository.find("e")).rejects.toThrow(
    "steps_json",
  );
});

it("prunes events, deliveries, occurrences and sequences", async () => {
  const { repository, execute } = doubleOf();

  await repository.prune({
    eventsBefore: "e",
    deliveriesBefore: "d",
    maximumEventsPerAccount: 7,
  });

  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute.mock.calls[0]?.[1]).toEqual({ before: "d" });
  expect(execute.mock.calls[1]?.[1]).toEqual({ before: "e", maximum: 7 });
  expect(execute.mock.calls[2]?.[1]).toEqual({ before: "e" });
});
