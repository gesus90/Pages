import { expect, it, vi } from "vitest";

import type { Database } from "@/backend/database/Database";
import { AgentRunLogRepository } from "./AgentRunLogRepository";

import type { RunLogQuery, StoredRunLogLine } from "./AgentRunLogRepository";

function doubleOf(rows: unknown[][] = []): {
  repository: AgentRunLogRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const transaction = vi.fn(
    async (work: (transaction: unknown) => Promise<unknown>) =>
      work({ execute }),
  );
  return {
    repository: new AgentRunLogRepository({
      query,
      transaction,
    } as unknown as Pick<Database, "query" | "transaction">),
    query,
    execute,
    transaction,
  };
}

const LINE: StoredRunLogLine = {
  runId: "r1",
  stepId: "s1",
  attemptId: "a1",
  at: "2026-01-01T00:00:00Z",
  level: "info",
  source: "server",
  message: "hello",
  isFiltered: true,
};
const QUERY: RunLogQuery = {
  runId: "r1",
  stepId: null,
  attemptId: null,
  minimumLevel: "debug",
  from: null,
  to: null,
  after: 0,
  limit: 2,
};

it("appends nothing without lines", async () => {
  const { repository, transaction } = doubleOf();

  await repository.append([]);

  expect(transaction).not.toHaveBeenCalled();
});

it("appends the lines in order", async () => {
  const { repository, execute } = doubleOf();

  await repository.append([LINE, { ...LINE, message: "two" }]);

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    run_id: "r1",
    message: "two",
    is_filtered: true,
  });
});

it("reads a page with all filters and reports more lines", async () => {
  const row = (id: number): unknown[] => [
    id,
    "2026-01-01",
    "warn",
    "runner",
    "s1",
    null,
    "m",
    0,
  ];
  const { repository, query } = doubleOf([row(1), row(2), row(3)]);

  const page = await repository.read({
    ...QUERY,
    stepId: "s1",
    attemptId: "a1",
    from: "f",
    to: "t",
    minimumLevel: "warn",
  });

  expect(page.hasMore).toBe(true);
  expect(page.rows).toHaveLength(2);
  expect(page.rows[0]).toEqual({
    id: 1,
    at: "2026-01-01",
    level: "warn",
    source: "runner",
    stepId: "s1",
    attemptId: null,
    message: "m",
    isFiltered: false,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    after: 0,
    limit: 3,
    step_id: "s1",
    attempt_id: "a1",
    from_at: "f",
    to_at: "t",
    level_0: "warn",
    level_1: "error",
  });
});

it("reads a last page without filters", async () => {
  const { repository, query } = doubleOf([
    [1, "t", "debug", "cli", null, null, "m", 1],
  ]);

  const page = await repository.read(QUERY);

  expect(page.hasMore).toBe(false);
  expect(page.rows[0]?.source).toBe("cli");
  expect(query.mock.calls[0]?.[0]).not.toContain("step_id =");
});

it("rejects a stored line with an unknown level or source", async () => {
  const level = doubleOf([[1, "t", "trace", "cli", null, null, "m", 0]]);
  const source = doubleOf([[1, "t", "info", "web", null, null, "m", 0]]);

  await expect(level.repository.read(QUERY)).rejects.toThrow("level");
  await expect(source.repository.read(QUERY)).rejects.toThrow("source");
});

it("prunes old lines and counts them", async () => {
  const { repository, query } = doubleOf([[5]]);

  await expect(repository.prune("cut")).resolves.toBe(5);
  expect(query.mock.calls[0]?.[1]).toEqual({ cutoff: "cut" });
  await expect(doubleOf([]).repository.prune("cut")).resolves.toBe(0);
});
