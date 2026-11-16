import { beforeEach, expect, it, vi } from "vitest";

import { PicaMobileNotificationEventRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { NewNotificationEvent } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";

const query = vi.fn();
const execute = vi.fn();
const transaction = partial<DatabaseTransaction>({ query, execute });
const database = partial<Database>({
  query,
  execute,
  transaction: async <Result>(
    work: (activeTransaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction),
});
const repository = new PicaMobileNotificationEventRepository(database);
const step = {
  instanceId: "instance",
  stepId: "step",
  loopId: null,
  number: 1,
  attempt: 1,
  iteration: null,
};
const event: NewNotificationEvent = {
  accountId: "user",
  planId: "plan",
  runId: "run",
  type: "step_started",
  occurredAt: "now",
  candidates: [
    { key: "old", steps: [step] },
    { key: "new", steps: [step] },
    { key: "new", steps: [step] },
  ],
  reason: null,
  deviceIds: ["device"],
  expiresAt: "later",
};

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("stores only new facts once with a sequence and device delivery", async () => {
  query.mockResolvedValueOnce([["old"]]).mockResolvedValueOnce([[3]]);
  const stored = await repository.record(event, "now");
  expect(stored).toMatchObject({
    seq: 4,
    type: "step_started",
    steps: [step],
    stepCount: 1,
  });
  expect(execute).toHaveBeenCalledTimes(5);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO pica_mobile_notification_occurrences"),
    expect.objectContaining({ occurrence_key: "new" }),
  );
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO pica_mobile_notification_deliveries"),
    expect.objectContaining({ device_id: "device", seq: 4 }),
  );
});

it("does not write when every fact has already been announced", async () => {
  query.mockResolvedValue([["old"], ["new"]]);
  expect(await repository.record(event, "now")).toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

it("stores terminal events without step details and reads typed event rows", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  expect(
    await repository.record(
      {
        ...event,
        type: "run_failed",
        candidates: [{ key: "end", steps: [step] }],
        deviceIds: [],
      },
      "now",
    ),
  ).toMatchObject({ seq: 1, steps: null, stepCount: null });
  query.mockResolvedValueOnce([
    [
      "event",
      "user",
      "plan",
      "run",
      1,
      "step_started",
      "now",
      JSON.stringify([step, { invalid: true }]),
      1,
      null,
    ],
  ]);
  expect(await repository.find("event")).toMatchObject({
    eventId: "event",
    steps: [step],
  });
  query.mockResolvedValueOnce([
    ["event", "user", "plan", "run", 1, "unknown", "now", null, null, null],
  ]);
  await expect(repository.find("event")).rejects.toThrow();
});
