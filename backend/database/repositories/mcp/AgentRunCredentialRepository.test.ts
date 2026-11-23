import { expect, it, vi } from "vitest";

import { AgentRunCredentialRepository } from "./AgentRunCredentialRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: DatabaseValue[][] = []): {
  repository: AgentRunCredentialRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  const execute = vi.fn();
  return {
    repository: new AgentRunCredentialRepository({ query, execute }),
    query,
    execute,
  };
}

function rowOf(
  tickets: string,
  operations = '["read",1]',
  reach = "full",
): DatabaseValue[] {
  return ["c1", "u1", "r1", "s1", operations, tickets, "900", reach];
}

it("stores a credential as hashes and serialized scope", async () => {
  const { repository, execute } = doubleOf();

  await repository.insert({
    id: "c1",
    userId: "u1",
    scope: {
      runId: "r1",
      stepId: "s1",
      operations: ["read"],
      tickets: [{ id: "t1", key: "A-1" }],
      reach: "read",
    },
    expiresAt: 900,
    tokenHash: "h",
    createdAt: 100,
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "c1",
    user_id: "u1",
    run_id: "r1",
    step_id: "s1",
    token_hash: "h",
    operations_json: '["read"]',
    ticket_ids_json: '[{"id":"t1","key":"A-1"}]',
    reach: "read",
    created_at: 100,
    expires_at: 900,
  });
});

it("maps a valid credential and drops malformed list entries", async () => {
  const { repository } = doubleOf([
    rowOf('[{"id":"t1","key":"A-1"},{"id":1,"key":"x"},null,"x"]'),
  ]);

  await expect(repository.findValid("h", 1)).resolves.toEqual({
    id: "c1",
    userId: "u1",
    scope: {
      runId: "r1",
      stepId: "s1",
      operations: ["read"],
      tickets: [{ id: "t1", key: "A-1" }],
      reach: "full",
    },
    expiresAt: 900,
  });
});

it("falls back to empty lists and the narrowest reach", async () => {
  const { repository } = doubleOf([rowOf("{}", "{}", "unknown")]);

  await expect(repository.findValid("h", 1)).resolves.toMatchObject({
    scope: { operations: [], tickets: [], reach: "tickets" },
  });
});

it("returns null without a valid credential", async () => {
  await expect(doubleOf().repository.findValid("h", 1)).resolves.toBeNull();
});

it("counts only credentials still valid when revoking a step", async () => {
  const { repository, query } = doubleOf([["500"], ["50"]]);

  await expect(repository.revoke("r1", "s1", 100)).resolves.toBe(1);
  expect(query.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    step_id: "s1",
    now: 100,
  });
});

it("revokes every node of a run", async () => {
  const { repository, query } = doubleOf();

  await expect(repository.revoke("r1", null, 100)).resolves.toBe(0);
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id: "r1", now: 100 });
});
