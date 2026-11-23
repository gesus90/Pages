import { expect, it, vi } from "vitest";

import { McpDevicePairingRepository } from "./McpDevicePairingRepository";

import type { NewMcpPairing } from "./McpDevicePairingRepository";

import type {
  Database as FullDatabase,
  DatabaseValue,
} from "@/backend/database/Database";

type Database = ConstructorParameters<typeof McpDevicePairingRepository>[0];

const PAIRING: NewMcpPairing = {
  id: "p1",
  userCodeHash: "c",
  deviceSecretHash: "s",
  deviceName: "Laptop",
  clientVersion: "1.0",
  addressHash: "a",
  createdAt: 10_000_000,
  expiresAt: 20_000_000,
};
const LIMITS = { startsPerWindow: 2, windowMs: 1000, openRequests: 2 };

function transactionOf(results: unknown[][][]): {
  repository: McpDevicePairingRepository;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn();
  const database = {
    query,
    execute,
    transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
      work({ query, execute }),
  } as unknown as Database;
  return { repository: new McpDevicePairingRepository(database), execute };
}

function queryOf(rows: DatabaseValue[][]): {
  repository: McpDevicePairingRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn<FullDatabase["query"]>(async () => rows);
  return {
    repository: new McpDevicePairingRepository({
      query,
      execute: vi.fn(),
      transaction: vi.fn(),
    }),
    query,
  };
}

it("stores a request within the limits", async () => {
  const { repository, execute } = transactionOf([
    [["0", null]],
    [["0", null]],
    [],
  ]);

  await expect(repository.insertWithinLimits(PAIRING, LIMITS)).resolves.toEqual(
    { kind: "stored" },
  );
  expect(execute).toHaveBeenCalledTimes(2);
});

it("stores a request when the counts are missing", async () => {
  const { repository } = transactionOf([[], [], []]);

  await expect(repository.insertWithinLimits(PAIRING, LIMITS)).resolves.toEqual(
    { kind: "stored" },
  );
});

it("limits an address that started too often", async () => {
  const { repository } = transactionOf([[["2", "9999500"]]]);

  await expect(repository.insertWithinLimits(PAIRING, LIMITS)).resolves.toEqual(
    { kind: "limited", retryAfterMs: 500 },
  );
});

it("limits an address with too many open requests", async () => {
  const { repository } = transactionOf([[["0", null]], [["2", "10000700"]]]);

  await expect(repository.insertWithinLimits(PAIRING, LIMITS)).resolves.toEqual(
    { kind: "limited", retryAfterMs: 700 },
  );
});

it("ignores a reached limit without a time to wait for", async () => {
  const { repository } = transactionOf([[["5", null]], [["5", null]], [["x"]]]);

  await expect(repository.insertWithinLimits(PAIRING, LIMITS)).resolves.toEqual(
    { kind: "code_taken" },
  );
});

it("finds a request by its code hash", async () => {
  const { repository } = queryOf([
    ["p1", "s", "Laptop", "1.0", "approved", "u1", "500"],
  ]);

  await expect(repository.findByCodeHash("c")).resolves.toEqual({
    id: "p1",
    deviceSecretHash: "s",
    deviceName: "Laptop",
    clientVersion: "1.0",
    status: "approved",
    userId: "u1",
    expiresAt: 500,
  });
});

it("maps a request without an account and rejects an unknown status", async () => {
  await expect(
    queryOf([
      ["p1", "s", "L", "1", "pending", null, "5"],
    ]).repository.findByCodeHash("c"),
  ).resolves.toMatchObject({ userId: null, status: "pending" });
  await expect(
    queryOf([
      ["p1", "s", "L", "1", "odd", null, "5"],
    ]).repository.findByCodeHash("c"),
  ).rejects.toThrow('invalid value for "status"');
  await expect(queryOf([]).repository.findByCodeHash("c")).resolves.toBeNull();
});

it("reports the outcome of polls, decisions and cancellations", async () => {
  const hit = queryOf([["p1"]]).repository;
  const miss = queryOf([]).repository;
  const decision = {
    id: "p1",
    userId: "u1",
    status: "approved" as const,
    now: 1,
  };

  await expect(hit.notePoll("p1", 10, 5)).resolves.toBe(true);
  await expect(miss.notePoll("p1", 10, 5)).resolves.toBe(false);
  await expect(hit.decide(decision)).resolves.toBe(true);
  await expect(miss.decide(decision)).resolves.toBe(false);
  await expect(hit.cancel("p1")).resolves.toBe(true);
  await expect(miss.cancel("p1")).resolves.toBe(false);
});

it("collects a confirmed request once", async () => {
  const device = { deviceId: "d1", tokenHash: "t", pairedAt: 3 };
  const { repository, query } = queryOf([["d1", "Laptop", "Ann", "ann"]]);

  await expect(repository.collect("p1", device, 4)).resolves.toEqual({
    deviceId: "d1",
    deviceName: "Laptop",
    displayName: "Ann",
    username: "ann",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    id: "p1",
    now: 4,
    device_id: "d1",
    token_hash: "t",
    paired_at: 3,
  });
  await expect(
    queryOf([]).repository.collect("p1", device, 4),
  ).resolves.toBeNull();
});
