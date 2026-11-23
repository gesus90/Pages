import { expect, it, vi } from "vitest";

import { AgentPlanSwarmMemoryRepository } from "./AgentPlanSwarmMemoryRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

const key = { runId: "run", nodeId: "node" };

const entryRow: DatabaseValue[] = [
  1,
  "event",
  "H1",
  "finding",
  "text",
  1,
  2,
  "2026-01-01T00:00:00.000Z",
];

function repositoryOf(
  answers: readonly (readonly (readonly DatabaseValue[])[])[] = [],
  transactionAnswers: readonly (readonly (readonly DatabaseValue[])[])[] = [],
): {
  readonly repository: AgentPlanSwarmMemoryRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly inner: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => []);
  for (const rows of answers)
    query.mockImplementationOnce(async () => rows.map((row) => [...row]));
  const inner = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const innerQuery = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of transactionAnswers)
    innerQuery.mockImplementationOnce(async () => rows.map((row) => [...row]));
  const transaction: DatabaseTransaction = {
    query: innerQuery,
    execute: inner,
  };
  const repository = new AgentPlanSwarmMemoryRepository({
    query,
    execute,
    transaction: async (work) => work(transaction),
  });
  return { repository, execute, inner, query };
}

it("configures the memory of a node", async () => {
  const { repository, execute } = repositoryOf();

  await repository.configure(key, true);
  await repository.configure(key, false);

  expect(execute.mock.calls.map((call) => call[1]?.keep_after_end)).toEqual([
    1, 0,
  ]);
});

it("publishes inside a transaction", async () => {
  const { repository } = repositoryOf([], [[[0, 0]], [], []]);

  const outcome = await repository.publish(
    {
      ...key,
      eventId: "event",
      author: "H1",
      kind: "finding",
      text: "text",
      isRedacted: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    { node: 5, author: null },
  );

  expect(outcome.status).toBe("published");
});

it("stores a refused entry", async () => {
  const { repository, execute } = repositoryOf();

  await repository.reject(key, {
    author: "H1",
    kind: "finding",
    text: "text",
    reason: "too long",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    body: "text",
    reason: "too long",
  });
});

it("compacts inside a transaction", async () => {
  const { repository } = repositoryOf([], [[[1, 9]]]);

  await expect(
    repository.compact({
      ...key,
      expectedVersion: 0,
      text: "t",
      contradictions: [],
      supersede: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).resolves.toEqual({ status: "version_conflict", version: 9 });
});

it("reads an untouched node as empty", async () => {
  const { repository } = repositoryOf([[]]);

  await expect(repository.state(key)).resolves.toEqual({
    revision: 0,
    snapshot: {
      text: "",
      revision: 0,
      version: 0,
      contradictions: [],
      updatedAt: null,
    },
  });
});

it("reads the state of a node", async () => {
  const { repository } = repositoryOf([
    [[4, "snap", 3, 2, '["x"]', "2026-01-01T00:00:00.000Z"]],
  ]);

  await expect(repository.state(key)).resolves.toEqual({
    revision: 4,
    snapshot: {
      text: "snap",
      revision: 3,
      version: 2,
      contradictions: ["x"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
});

it("reads the changes oldest first and the latest entries newest first", async () => {
  const { repository, query } = repositoryOf([[entryRow], [entryRow]]);

  const changes = await repository.changes(key, 0, 5);
  const latest = await repository.latest(key, 0, 5);

  expect(changes[0]?.supersededBy).toBe(2);
  expect(latest).toHaveLength(1);
  expect(query.mock.calls[0]?.[0]).toContain("ORDER BY revision\n");
  expect(query.mock.calls[1]?.[0]).toContain("ORDER BY revision DESC");
});

it("reads the revision an agent received", async () => {
  const { repository } = repositoryOf([[[6]], []]);

  await expect(repository.readRevision(key, "H1")).resolves.toBe(6);
  await expect(repository.readRevision(key, "H2")).resolves.toBe(0);
});

it("records that an agent received entries", async () => {
  const { repository, execute } = repositoryOf();

  await repository.markRead(key, "H1", 4);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    agent_id: "H1",
    revision: 4,
  });
});

it("assembles the whole memory of a node", async () => {
  const { repository } = repositoryOf([
    [[2, "snap", 1, 1, "[]", null]],
    [entryRow],
    [["H1", "finding", "text", "why", "2026-01-01T00:00:00.000Z"]],
    [["H1", 2]],
  ]);

  const view = await repository.view(key);

  expect(view.revision).toBe(2);
  expect(view.entries).toHaveLength(1);
  expect(view.rejections).toEqual([
    {
      author: "H1",
      kind: "finding",
      text: "text",
      reason: "why",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  expect(view.reads).toEqual([{ agent: "H1", revision: 2 }]);
});

it("moves the memory of a continued run", async () => {
  const { repository, inner } = repositoryOf([], [[]]);

  await expect(repository.adopt("from", "to", "node")).resolves.toBe(true);
  expect(inner).toHaveBeenCalledTimes(4);
});

it("keeps the memory a run already has", async () => {
  const { repository, inner } = repositoryOf([], [[["to"]]]);

  await expect(repository.adopt("from", "to", "node")).resolves.toBe(false);
  expect(inner).not.toHaveBeenCalled();
});

it("discards the memory that does not outlive the run", async () => {
  const { repository, inner } = repositoryOf();

  await repository.discardUnkept("run");

  expect(inner).toHaveBeenCalledTimes(4);
});
