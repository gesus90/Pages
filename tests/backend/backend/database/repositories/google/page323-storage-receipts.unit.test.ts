import { expect, it, vi } from "vitest";

import { StorageOperationRepository } from "@/backend/database/repositories/google/StorageOperationRepository";

import type { Database } from "@/backend/database/Database";

it("reserves a write atomically before external work and reads a concurrent receipt instead of claiming it twice", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([["operation"]]);
  const execute = vi.fn<Database["execute"]>();
  const repository = new StorageOperationRepository({ query, execute });
  expect(
    await repository.claim("Ed", "operation", {
      operation: "storage.upload",
      fingerprint: "digest",
    }),
  ).toBeNull();
  expect(query.mock.calls[0]?.[0]).toContain(
    "ON CONFLICT (user_id, operation_id) DO NOTHING",
  );
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["digest", "storage.upload", "null"]]);
  expect(
    await repository.claim("Ed", "operation", {
      operation: "storage.upload",
      fingerprint: "digest",
    }),
  ).toEqual({
    operation: "storage.upload",
    fingerprint: "digest",
    resultJson: "null",
  });
  await repository.finish("Ed", "operation", '{"ok":true}');
  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "Ed",
    operation_id: "operation",
    result_json: '{"ok":true}',
  });
});
