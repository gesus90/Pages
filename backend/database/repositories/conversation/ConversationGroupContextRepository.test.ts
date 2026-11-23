import { expect, it, vi } from "vitest";

import {
  ConversationGroupContextRepository,
  type NewGroupSummary,
} from "./ConversationGroupContextRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationGroupContextRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return {
    repository: new ConversationGroupContextRepository({ execute, query }),
    execute,
    query,
  };
}

function row(
  overrides: Partial<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const base: DatabaseValue[] = [
    "c1",
    "summary",
    '["d1",1]',
    '["o1"]',
    '["r1"]',
    '[{"fromSequence":1,"toSequence":2,"messageIds":["m1"]},{"fromSequence":"x"},3,null]',
    7,
    1,
    "behind",
    null,
    2,
    "2026-01-01T00:00:00Z",
    null,
  ];
  Object.assign(base, overrides);
  return base;
}

const summary: NewGroupSummary = {
  summary: "s",
  decisions: ["d"],
  openItems: ["o"],
  responsibilities: ["r"],
  sources: [{ fromSequence: 1, toSequence: 2, messageIds: ["m1"] }],
  throughSequence: 2,
  hasExcerpts: true,
  status: "current",
  updatedAt: "2026-01-01T00:00:00Z",
};

it("returns null before the first context", async () => {
  const { repository } = databaseOf();
  await expect(repository.find("c1")).resolves.toBeNull();
});

it("reads a stored context and drops malformed list entries", async () => {
  const { repository } = databaseOf([row()]);
  await expect(repository.find("c1")).resolves.toEqual({
    conversationId: "c1",
    summary: "summary",
    decisions: ["d1"],
    openItems: ["o1"],
    responsibilities: ["r1"],
    sources: [{ fromSequence: 1, toSequence: 2, messageIds: ["m1"] }],
    throughSequence: 7,
    hasExcerpts: true,
    status: "behind",
    errorCode: null,
    revision: 2,
    updatedAt: "2026-01-01T00:00:00Z",
    attemptedAt: null,
  });
});

it("maps unknown status and non-array JSON to safe values", async () => {
  const { repository } = databaseOf([
    row({ 2: "{}", 3: "{}", 4: "{}", 5: "{}", 8: "weird" }),
  ]);
  await expect(repository.find("c1")).resolves.toMatchObject({
    decisions: [],
    openItems: [],
    responsibilities: [],
    sources: [],
    status: "unavailable",
  });
});

it("rejects sources that miss a field", async () => {
  const sources = JSON.stringify([
    { fromSequence: 1, toSequence: 2 },
    { fromSequence: 1, toSequence: "2", messageIds: [] },
    { fromSequence: 1, messageIds: [] },
    { fromSequence: 1, toSequence: 2, messageIds: "m" },
  ]);
  const { repository } = databaseOf([row({ 5: sources })]);
  await expect(repository.find("c1")).resolves.toMatchObject({ sources: [] });
});

it("saves a summary only against the expected revision", async () => {
  const saved = databaseOf([["c1"]]);
  await expect(saved.repository.saveSummary("c1", summary, 1)).resolves.toBe(
    true,
  );
  expect(saved.query.mock.calls[0]?.[1]).toMatchObject({
    decisions: '["d"]',
    expected_revision: 1,
    status: "current",
  });
  const stale = databaseOf();
  await expect(stale.repository.saveSummary("c1", summary, 1)).resolves.toBe(
    false,
  );
});

it("records a failed attempt", async () => {
  const { repository, execute } = databaseOf();
  await repository.recordFailure("c1", {
    status: "behind",
    errorCode: "timeout",
    attemptedAt: "2026-01-01T00:00:00Z",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    status: "behind",
    error_code: "timeout",
    attempted_at: "2026-01-01T00:00:00Z",
  });
});

it("invalidates the summary of a group", async () => {
  const { repository, execute } = databaseOf();
  await repository.invalidate("c1", "2026-01-01T00:00:00Z");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    at: "2026-01-01T00:00:00Z",
  });
});

it("lists the candidates and the changed sources", async () => {
  const candidates = databaseOf([["c1", 3n]]);
  await expect(candidates.repository.candidates(4)).resolves.toEqual([
    { conversationId: "c1", throughSequence: 3 },
  ]);
  expect(candidates.query.mock.calls[0]?.[1]).toEqual({ limit: 4 });
  const changed = databaseOf([["c1"], ["c2"]]);
  await expect(changed.repository.changedSources()).resolves.toEqual([
    "c1",
    "c2",
  ]);
});

it("tells whether the source of a context is current", async () => {
  await expect(databaseOf().repository.isSourceCurrent("c1")).resolves.toBe(
    true,
  );
  await expect(
    databaseOf([["c1"]]).repository.isSourceCurrent("c1"),
  ).resolves.toBe(false);
});

it("counts the pending messages and defaults to zero", async () => {
  const { repository, query } = databaseOf([[5]]);
  await expect(repository.pendingCount("c1", 2)).resolves.toBe(5);
  expect(query.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    after_sequence: 2,
  });
  await expect(databaseOf().repository.pendingCount("c1", 2)).resolves.toBe(0);
});
