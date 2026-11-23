import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { ManagementAuditRepository } from "./ManagementAuditRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: ManagementAuditRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  return {
    execute,
    query,
    repository: new ManagementAuditRepository({
      execute,
      query,
    } as unknown as DatabaseTransaction),
  };
}

it("records an audit event", async () => {
  const { repository, execute } = repositoryOf();
  await repository.record("a", "read", "user:1");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO management_audit"),
    { actor_id: "a", action: "read", target: "user:1" },
  );
});

it("lists audit events", async () => {
  const { repository } = repositoryOf([["1", "a", "t", "act", "tg", "{}"]]);
  await expect(repository.list()).resolves.toEqual([
    {
      id: "1",
      actorId: "a",
      at: "t",
      action: "act",
      target: "tg",
      change: "{}",
    },
  ]);
});
