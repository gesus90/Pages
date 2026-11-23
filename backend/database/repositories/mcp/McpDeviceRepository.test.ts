import { expect, it, vi } from "vitest";

import { McpDeviceRepository } from "./McpDeviceRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: DatabaseValue[][] = []): {
  repository: McpDeviceRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  return {
    repository: new McpDeviceRepository({ query, execute: vi.fn() }),
    query,
  };
}

const DEVICE_ROW = ["d1", "u1", "Laptop", "1.0", "100", "200"];

it("touches a token and maps the device with its account", async () => {
  const { repository, query } = doubleOf([[...DEVICE_ROW, "Ann", "ann"]]);

  await expect(repository.touchByTokenHash("h", 300)).resolves.toEqual({
    id: "d1",
    userId: "u1",
    name: "Laptop",
    clientVersion: "1.0",
    pairedAt: 100,
    lastUsedAt: 200,
    displayName: "Ann",
    username: "ann",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ token_hash: "h", now: 300 });
});

it("returns null for an unknown token", async () => {
  await expect(doubleOf().repository.touchByTokenHash("h", 1)).resolves.toBe(
    null,
  );
});

it("reports whether a revocation hit a valid pairing", async () => {
  await expect(
    doubleOf([["d1"]]).repository.revokeByTokenHash("h", 1),
  ).resolves.toBe(true);
  await expect(doubleOf().repository.revokeByTokenHash("h", 1)).resolves.toBe(
    false,
  );
  await expect(
    doubleOf([["d1"]]).repository.revokeForUser("d1", "u1", 1),
  ).resolves.toBe(true);
  await expect(
    doubleOf().repository.revokeForUser("d1", "u1", 1),
  ).resolves.toBe(false);
});

it("lists devices with and without a last use", async () => {
  const { repository } = doubleOf([
    DEVICE_ROW,
    ["d2", "u1", "Phone", "1.1", "50", null],
  ]);

  await expect(repository.listForUser("u1")).resolves.toMatchObject([
    { id: "d1", lastUsedAt: 200 },
    { id: "d2", lastUsedAt: null },
  ]);
});
