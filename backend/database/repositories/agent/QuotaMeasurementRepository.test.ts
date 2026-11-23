import { expect, it, vi } from "vitest";

import {
  QuotaMeasurementRepository,
  type QuotaMeasurement,
} from "./QuotaMeasurementRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

const SERIES = {
  resetsAt: "2026-01-02T00:00:00.000Z",
  durationMinutes: 300,
  used: 40,
  pace: {
    measuredAt: 1,
    rate: null,
    isNewWindow: false,
    wasDepleting: false,
  },
  points: [[1, 40]],
};

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: Database;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const transaction = async (
    work: (inner: DatabaseTransaction) => Promise<unknown>,
  ): Promise<unknown> => work({ query, execute });
  return {
    database: { query, execute, transaction } as unknown as Database,
    execute,
    query,
  };
}

it("stores the first measurement of a locked connection", async () => {
  const { database, execute } = databaseOf([["c1"]], []);
  const measure = vi.fn((previous: QuotaMeasurement | null) => ({
    credentialRevision: "r1",
    windows: previous ? previous.windows : {},
  }));
  await new QuotaMeasurementRepository(database).update("c1", 10, measure);
  expect(measure).toHaveBeenCalledWith(null);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    observed_at: 10,
    credential_revision: "r1",
    windows: "{}",
  });
});

it("hands the previous measurement to a newer observation", async () => {
  const { database, execute } = databaseOf(
    [["c1"]],
    [[5n, null, JSON.stringify({ five_hour: SERIES })]],
  );
  const measure = vi.fn((previous: QuotaMeasurement | null) => ({
    credentialRevision: null,
    windows: previous?.windows ?? {},
  }));
  await new QuotaMeasurementRepository(database).update("c1", 6, measure);
  expect(measure).toHaveBeenCalledWith({
    observedAt: 5,
    credentialRevision: null,
    windows: { five_hour: SERIES },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each([6, 5])(
  "ignores an observation at %s that is not newer",
  async (at) => {
    const { database, execute } = databaseOf([["c1"]], [[6, "r", "{}"]]);
    const measure = vi.fn(() => ({ credentialRevision: null, windows: {} }));
    await new QuotaMeasurementRepository(database).update("c1", at, measure);
    expect(measure).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  },
);

it("does nothing for a connection that does not exist", async () => {
  const { database, query, execute } = databaseOf([]);
  const measure = vi.fn(() => ({ credentialRevision: null, windows: {} }));
  await new QuotaMeasurementRepository(database).update("c1", 1, measure);
  expect(query).toHaveBeenCalledTimes(1);
  expect(execute).not.toHaveBeenCalled();
});

it("reads the measured windows of the given connections", async () => {
  const window = { ...SERIES, points: undefined };
  const { database, query } = databaseOf([
    ["c1", JSON.stringify({ five_hour: window })],
  ]);
  const result = await new QuotaMeasurementRepository(database).read(["c1"]);
  expect(result).toEqual(new Map([["c1", { five_hour: window }]]));
  expect(query.mock.calls[0]?.[1]).toEqual({ ids: '["c1"]' });
});

it("reads nothing without ids", async () => {
  const { database, query } = databaseOf();
  await expect(
    new QuotaMeasurementRepository(database).read([]),
  ).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});
