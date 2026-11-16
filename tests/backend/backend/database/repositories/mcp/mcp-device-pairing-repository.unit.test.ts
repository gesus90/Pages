import { beforeEach, expect, it, vi } from "vitest";

import { McpDevicePairingRepository } from "@/backend/database/repositories/mcp/McpDevicePairingRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { NewMcpPairing } from "@/backend/database/repositories/mcp/McpDevicePairingRepository";

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
const repository = new McpDevicePairingRepository(database);
const pairing: NewMcpPairing = {
  id: "pairing",
  userCodeHash: "code-hash",
  deviceSecretHash: "secret-hash",
  deviceName: "Device",
  clientVersion: "1",
  addressHash: "address-hash",
  createdAt: 1000,
  expiresAt: 2000,
};
const limits = { startsPerWindow: 2, windowMs: 500, openRequests: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("stores a request only after checking rate, open requests and code uniqueness", async () => {
  query
    .mockResolvedValueOnce([[0, null]])
    .mockResolvedValueOnce([[0, null]])
    .mockResolvedValueOnce([]);
  expect(await repository.insertWithinLimits(pairing, limits)).toEqual({
    kind: "stored",
  });
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("INSERT INTO mcp_device_pairing"),
    expect.objectContaining({
      user_code_hash: "code-hash",
      device_secret_hash: "secret-hash",
    }),
  );
});

it("reports the appropriate retry delay when limits are reached", async () => {
  query.mockResolvedValueOnce([[2, "800"]]);
  expect(await repository.insertWithinLimits(pairing, limits)).toEqual({
    kind: "limited",
    retryAfterMs: 300,
  });
  query.mockResolvedValueOnce([[0, null]]).mockResolvedValueOnce([[1, "1500"]]);
  expect(await repository.insertWithinLimits(pairing, limits)).toEqual({
    kind: "limited",
    retryAfterMs: 500,
  });
});

it("does not reuse an existing pairing code", async () => {
  query
    .mockResolvedValueOnce([[0, null]])
    .mockResolvedValueOnce([[0, null]])
    .mockResolvedValueOnce([["existing"]]);
  expect(await repository.insertWithinLimits(pairing, limits)).toEqual({
    kind: "code_taken",
  });
});

it("reads a typed pairing and rejects an invalid stored status", async () => {
  query.mockResolvedValueOnce([
    ["pairing", "secret-hash", "Device", "1", "pending", null, "2000"],
  ]);
  expect(await repository.findByCodeHash("code-hash")).toMatchObject({
    id: "pairing",
    status: "pending",
    expiresAt: 2000,
  });
  query.mockResolvedValueOnce([
    ["pairing", "secret-hash", "Device", "1", "unknown", null, "2000"],
  ]);
  await expect(repository.findByCodeHash("code-hash")).rejects.toThrow();
});
