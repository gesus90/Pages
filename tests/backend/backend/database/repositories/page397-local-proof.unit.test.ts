import { expect, it, vi } from "vitest";

import { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";

import type { LocalOwnerProof } from "@/backend/agents/local/LocalSessionContracts";

const PROOF: LocalOwnerProof = {
  instanceKey: "instance",
  instanceId: "owner",
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  unit: "pages-local-owner.service",
  invocationId: "a".repeat(32),
  boot: "boot",
  uid: 1000,
  pid: 42,
  start: 100,
  cgroup: "/test/owner",
  arguments: ["node", "local-agent.mjs"],
};

it("reads repeated identical ownership proofs without issuing UPDATE", async () => {
  const query = vi.fn().mockResolvedValue([[JSON.stringify(PROOF)]]);
  const owners = new LocalSessionRepository({ query, execute: vi.fn() });
  for (let attempt = 0; attempt < 10; attempt += 1)
    await owners.prove("owner", PROOF);
  expect(
    query.mock.calls.every(([statement]) =>
      String(statement).includes("SELECT proof"),
    ),
  ).toBe(true);
});

it("writes an absent proof once and rejects a changed proof without overwriting it", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[null]])
    .mockResolvedValueOnce([["owner"]]);
  const owners = new LocalSessionRepository({ query, execute: vi.fn() });
  await owners.prove("owner", PROOF);
  expect(query.mock.calls[1][0]).toContain("AND proof IS NULL");
  query.mockResolvedValue([[JSON.stringify(PROOF)]]);
  await expect(owners.prove("owner", { ...PROOF, pid: 99 })).rejects.toThrow(
    "proof changed",
  );
  expect(
    query.mock.calls.filter(([statement]) =>
      String(statement).includes("UPDATE"),
    ),
  ).toHaveLength(1);
});

it("accepts a concurrent identical adoption but never replaces its immutable identity", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[null]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[JSON.stringify(PROOF)]]);
  const owners = new LocalSessionRepository({ query, execute: vi.fn() });
  await expect(owners.prove("owner", PROOF)).resolves.toBeUndefined();
  expect(
    query.mock.calls.filter(([statement]) =>
      String(statement).includes("UPDATE"),
    ),
  ).toHaveLength(1);
});
