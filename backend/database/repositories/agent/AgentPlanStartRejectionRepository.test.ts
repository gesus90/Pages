import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanStartRejectionRepository } from "./AgentPlanStartRejectionRepository";

import type {
  Database,
  DatabaseValue,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

const REJECTION: AgentPlanStartRejection = {
  id: "e1",
  createdAt: "2026-01-01T00:00:00.000Z",
  action: "play",
  planRevision: 1,
  isSavedRevision: true,
  error: "plan_invalid",
  conflict: null,
  reservation: "not_requested",
  targetResolution: "unknown",
};

interface Setup {
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<Database["query"]>;
  readonly repository: AgentPlanStartRejectionRepository;
}

function setup(rows: DatabaseValue[][]): Setup {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const query = vi.fn<Database["query"]>(async () => rows);
  const transaction = vi.fn(async (work: (t: DatabaseTransaction) => unknown) =>
    work({ execute } as unknown as DatabaseTransaction),
  );
  const repository = new AgentPlanStartRejectionRepository({
    query,
    transaction: transaction as unknown as Database["transaction"],
  });
  return { execute, query, repository };
}

it("appends a validated refusal and runs the journal", async () => {
  const { execute, repository } = setup([]);
  const journal = vi.fn(async () => undefined);

  await repository.append("u1", "p1", REJECTION, journal);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ id: "e1", user_id: "u1" });
  expect(journal).toHaveBeenCalledTimes(1);
});

it("appends without a journal", async () => {
  const { execute, repository } = setup([]);

  await repository.append("u1", "p1", REJECTION);

  expect(execute).toHaveBeenCalledTimes(1);
});

it("refuses to append an invalid refusal", async () => {
  const { repository } = setup([]);

  await expect(
    repository.append("u1", "p1", { ...REJECTION, id: "" }),
  ).rejects.toMatchObject({ code: "plan_invalid" });
});

it("reads the latest refusal or null", async () => {
  const found = setup([[JSON.stringify(REJECTION)]]);
  const empty = setup([]);

  expect(await found.repository.latest("u1", "p1")).toEqual(REJECTION);
  expect(await empty.repository.latest("u1", "p1")).toBeNull();
});

it("pages with a cursor when another entry follows", async () => {
  const { repository } = setup([
    [JSON.stringify(REJECTION)],
    [JSON.stringify({ ...REJECTION, id: "e0" })],
  ]);

  expect(await repository.page("u1", "p1", null)).toEqual({
    entry: REJECTION,
    nextBefore: "e1",
  });
});

it("pages without a cursor for the last entry or none", async () => {
  const last = setup([[JSON.stringify(REJECTION)]]);
  const none = setup([]);

  expect(await last.repository.page("u1", "p1", "x")).toEqual({
    entry: REJECTION,
    nextBefore: null,
  });
  expect(await none.repository.page("u1", "p1", null)).toEqual({
    entry: null,
    nextBefore: null,
  });
});
