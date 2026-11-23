import { expect, it, vi } from "vitest";

import {
  compactMemory,
  contradictionsOf,
  entryOf,
  keyParameters,
  publishMemoryEntry,
} from "./AgentPlanSwarmMemoryWrites";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { SwarmMemoryDraft } from "./AgentPlanSwarmMemoryWrites";

const draft: SwarmMemoryDraft = {
  runId: "run",
  nodeId: "node",
  eventId: "event",
  author: "H1",
  kind: "finding",
  text: "text",
  isRedacted: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const storedRow: DatabaseValue[] = [
  3,
  "event",
  "H1",
  "finding",
  "text",
  0,
  null,
  "2026-01-01T00:00:00.000Z",
];

function transactionOf(
  answers: readonly (readonly (readonly DatabaseValue[])[])[],
): {
  readonly transaction: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers)
    query.mockImplementationOnce(async () => rows.map((row) => [...row]));
  return { transaction: { query, execute }, execute };
}

it("reads an entry from its row", () => {
  expect(entryOf(storedRow)).toEqual({
    revision: 3,
    eventId: "event",
    author: "H1",
    kind: "finding",
    text: "text",
    isRedacted: false,
    supersededBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

it("refuses an entry of an unknown kind", () => {
  expect(() => entryOf([3, "e", "a", "bogus", "t", 0, null, "c"])).toThrow(
    'Unknown swarm memory kind "bogus".',
  );
});

it("reads stored contradictions and ignores anything else", () => {
  expect(contradictionsOf('["a",1,"b"]')).toEqual(["a", "b"]);
  expect(contradictionsOf('{"a":1}')).toEqual([]);
});

it("names the key parameters", () => {
  expect(keyParameters(draft)).toEqual({ run_id: "run", node_id: "node" });
});

it("publishes with the next revision", async () => {
  const { transaction, execute } = transactionOf([[[4, 0]], [], [[2, 1]]]);

  const outcome = await publishMemoryEntry(transaction, draft, {
    node: 10,
    author: 5,
  });

  expect(outcome).toMatchObject({
    status: "published",
    entry: { revision: 5, supersededBy: null, isRedacted: true },
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ is_redacted: 1 });
});

it("publishes without a count row and without an author limit", async () => {
  const { transaction } = transactionOf([[[0, 0]], [], []]);

  const outcome = await publishMemoryEntry(
    transaction,
    { ...draft, isRedacted: false },
    { node: 1, author: null },
  );

  expect(outcome).toMatchObject({
    status: "published",
    entry: { revision: 1 },
  });
});

it("returns the stored entry of a repeated publish", async () => {
  const { transaction } = transactionOf([[[3, 0]], [storedRow]]);

  const outcome = await publishMemoryEntry(transaction, draft, {
    node: 10,
    author: null,
  });

  expect(outcome).toMatchObject({ status: "duplicate" });
});

it("reports a reused event id with other content", async () => {
  const other = [...storedRow];
  other[4] = "other";
  const { transaction } = transactionOf([[[3, 0]], [other]]);

  await expect(
    publishMemoryEntry(transaction, draft, { node: 10, author: null }),
  ).resolves.toEqual({ status: "event_conflict" });
});

it("refuses a publish beyond the node limit", async () => {
  const { transaction } = transactionOf([[[3, 0]], [], [[2, 0]]]);

  await expect(
    publishMemoryEntry(transaction, draft, { node: 2, author: null }),
  ).resolves.toEqual({ status: "node_limit", limit: 2 });
});

it("refuses a publish beyond the author limit", async () => {
  const { transaction } = transactionOf([[[3, 0]], [], [[2, 2]]]);

  await expect(
    publishMemoryEntry(transaction, draft, { node: 10, author: 2 }),
  ).resolves.toEqual({ status: "worker_limit", limit: 2 });
});

it("fails when the state row cannot be locked", async () => {
  const { transaction } = transactionOf([[]]);

  await expect(
    publishMemoryEntry(transaction, draft, { node: 10, author: null }),
  ).rejects.toThrow("Swarm memory state is missing.");
});

const compaction = {
  runId: "run",
  nodeId: "node",
  expectedVersion: 2,
  text: "snapshot",
  contradictions: ["c"],
  supersede: [1, 1, 2],
  updatedAt: "2026-01-02T00:00:00.000Z",
};

it("replaces the snapshot and supersedes each revision once", async () => {
  const { transaction, execute } = transactionOf([[[7, 2]]]);

  const outcome = await compactMemory(transaction, compaction);

  expect(outcome).toEqual({
    status: "compacted",
    snapshot: {
      text: "snapshot",
      revision: 7,
      version: 3,
      contradictions: ["c"],
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    superseded: [1, 2],
  });
  expect(execute).toHaveBeenCalledTimes(4);
});

it("refuses a compaction of an outdated version", async () => {
  const { transaction } = transactionOf([[[7, 5]]]);

  await expect(compactMemory(transaction, compaction)).resolves.toEqual({
    status: "version_conflict",
    version: 5,
  });
});
