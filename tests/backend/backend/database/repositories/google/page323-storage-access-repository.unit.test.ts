import { expect, it, vi } from "vitest";

import { StorageAccessRepository } from "@/backend/database/repositories/google/StorageAccessRepository";

import type { Database } from "@/backend/database/Database";

it("binds folder grants to the Google account and current group, department and role membership", async () => {
  const query = vi.fn<Database["query"]>(async () => [
    ["google", "pages", "Pages", "group", "a-team"],
  ]);
  const repository = new StorageAccessRepository({
    query,
    execute: vi.fn<Database["execute"]>(),
  });
  expect(await repository.grants("Conan", "google")).toEqual([
    {
      permissionId: "google",
      folderRef: "pages",
      folderName: "Pages",
      targetKind: "group",
      targetId: "a-team",
    },
  ]);
  const [sql, parameters] = query.mock.calls[0] ?? [];
  expect(parameters).toEqual({ user_id: "Conan", permission_id: "google" });
  expect(sql).toContain("user_group_members WHERE user_id = $user_id");
  expect(sql).toContain("department_members WHERE user_id = $user_id");
  expect(sql).toContain("user_authorization WHERE user_id = $user_id");
  // PostgreSQL cannot type a parameter whose first use is `IS NULL`.
  expect(sql).toContain("CAST($user_id AS TEXT) IS NULL");
  query.mockResolvedValueOnce([]);
  expect(await repository.grants("Conan", "other-google")).toEqual([]);
});

it("writes actor identity and metadata to history without storing file content or replacing other grants", async () => {
  const execute = vi.fn<Database["execute"]>();
  const query = vi.fn<Database["query"]>(async () => [
    ["Ed", "Ed", "upload", "report", "2026-11-13"],
  ]);
  const repository = new StorageAccessRepository({ execute, query });
  await repository.record(
    { actorId: "Ed", actorName: "Ed", operation: "upload", ref: "report" },
    "google",
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: expect.any(String) as unknown,
    actor_id: "Ed",
    actor_name: "Ed",
    operation: "upload",
    ref: "report",
    permission_id: "google",
  });
  expect(await repository.history("Ed", "google")).toEqual([
    {
      actorId: "Ed",
      actorName: "Ed",
      operation: "upload",
      ref: "report",
      createdAt: "2026-11-13",
    },
  ]);
  expect(query.mock.calls[0]?.[0]).toContain(
    "CAST($user_id AS TEXT) IS NULL OR actor_id = $user_id",
  );
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "Ed",
    permission_id: "google",
  });
  await repository.setGrant(
    {
      permissionId: "google",
      folderRef: "pages",
      folderName: "Pages",
      targetKind: "group",
      targetId: "a-team",
    },
    false,
  );
  expect(execute.mock.calls[1]?.[0]).toContain("AND target_id = $target_id");
});
