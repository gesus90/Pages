import { expect, it, vi } from "vitest";

import { StorageOperationRepository } from "./StorageOperationRepository";

import type { Database } from "@/backend/database/Database";

const RECEIPT = { operation: "drive.upload", fingerprint: "fp" };

it("returns null when the claim reserved a new operation", async () => {
  const query = vi.fn<Database["query"]>(async () => [["op1"]]);
  const repository = new StorageOperationRepository({
    query,
    execute: vi.fn(),
  });

  await expect(repository.claim("u1", "op1", RECEIPT)).resolves.toBeNull();
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    user_id: "u1",
    operation_id: "op1",
    operation: "drive.upload",
    fingerprint: "fp",
  });
});

it("returns the stored operation of a duplicate claim", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["fp", "drive.upload", "{}"]]);
  const repository = new StorageOperationRepository({
    query,
    execute: vi.fn(),
  });

  await expect(repository.claim("u1", "op1", RECEIPT)).resolves.toEqual({
    fingerprint: "fp",
    operation: "drive.upload",
    resultJson: "{}",
  });
});

it("fails when a duplicate claim has no stored receipt", async () => {
  const query = vi.fn(async () => []);
  const repository = new StorageOperationRepository({
    query,
    execute: vi.fn(),
  });

  await expect(repository.claim("u1", "op1", RECEIPT)).rejects.toThrow(
    "Storage receipt unavailable.",
  );
});

it("finishes a pending operation with its result", async () => {
  const execute = vi.fn();
  const repository = new StorageOperationRepository({
    query: vi.fn(),
    execute,
  });

  await repository.finish("u1", "op1", '{"ok":true}');

  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    operation_id: "op1",
    result_json: '{"ok":true}',
  });
});
