import { expect, it, vi } from "vitest";

import { AgentPlanWorkRepository } from "./AgentPlanWorkRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanWorkRecord } from "@/definition/AgentPlanWork";

const mocks = vi.hoisted(() => ({
  readPlanWorkRecord: vi.fn((input: unknown) => input),
}));

vi.mock("@/backend/agents/AgentPlanWorkInput", () => ({
  readPlanWorkRecord: mocks.readPlanWorkRecord,
}));

const key = {
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  ticketId: "ticket",
};

function runJson(): string {
  return JSON.stringify({
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "user",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "running",
    stopRequested: false,
    steps: [],
  });
}

function transactionOf(rows: readonly (readonly string[])[]): {
  readonly transaction: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () =>
    rows.map((row) => [...row]),
  );
  return { transaction: { query, execute }, execute };
}

it("reads the run and the adopted snapshot", async () => {
  const { transaction } = transactionOf([[runJson(), '{"a":1}']]);

  const basis = await new AgentPlanWorkRepository(transaction).basis("run");

  expect(basis?.run.id).toBe("run");
  expect(basis?.snapshot).toEqual({ a: 1 });
});

it("reads no basis for an unknown run", async () => {
  const { transaction } = transactionOf([]);

  await expect(
    new AgentPlanWorkRepository(transaction).basis("run"),
  ).resolves.toBeNull();
});

it("finds the latest record of an attempt", async () => {
  const { transaction } = transactionOf([['{"revision":2}']]);

  await expect(
    new AgentPlanWorkRepository(transaction).find(key),
  ).resolves.toEqual({ revision: 2 });
});

it("finds nothing without a stored record", async () => {
  const { transaction } = transactionOf([]);

  await expect(
    new AgentPlanWorkRepository(transaction).find(key),
  ).resolves.toBeNull();
});

it("appends a revision", async () => {
  const { transaction, execute } = transactionOf([]);
  const record: AgentPlanWorkRecord = {
    revision: 3,
    requirementsHash: "r",
    contentHash: "c",
    scopeHash: "s",
    scope: [],
    note: "",
    proofs: [],
    checks: [],
    confirmed: false,
  };

  await new AgentPlanWorkRepository(transaction).insert(key, record);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    ...key,
    revision: 3,
    record: JSON.stringify(record),
  });
});
