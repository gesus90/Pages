import { beforeEach, expect, it, vi } from "vitest";

import { readAgentPayload } from "@/backend/storage/AgentPayloadFileStore";

import {
  readAttemptRow,
  readEventRow,
  readMessageRow,
  readOpenRouterUsageRow,
  readStoredEventRow,
  readUsageRow,
} from "./AgentSessionRows";

import type { DatabaseValue } from "@/backend/database/Database";
import type { AgentSessionGitState } from "@/definition/AgentSessionJournal";

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readAgentPayload: vi.fn(
    async (...[, inline, reference]: [unknown, string, string | null]) =>
      reference === null ? inline : `file:${reference}`,
  ),
}));

beforeEach(() => {
  vi.mocked(readAgentPayload).mockClear();
});

function attemptRow(
  overrides: Record<number, DatabaseValue> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    "p1",
    "r1",
    "s1",
    "u1",
    "codex_cli",
    "i1",
    "g1",
    "running",
    50,
    200,
    "acp_usage_update",
    "t-context",
    "model-x",
    "plan",
    "t-model",
    "high",
    "adapter_selector",
    "t-reasoning",
    "/work",
    "branch",
    "main",
    "t-workspace",
    "t-updated",
    "1.5",
    "USD",
    "c1",
    "ag1",
    "req-model",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("reads a complete attempt", () => {
  expect(readAttemptRow(attemptRow())).toEqual({
    key: { attemptId: "a1", planId: "p1", runId: "r1", stepId: "s1" },
    userId: "u1",
    provider: "codex_cli",
    instanceId: "i1",
    connectionId: "c1",
    agentId: "ag1",
    requestedModel: "req-model",
    groupId: "g1",
    state: "running",
    context: {
      contextUsed: 50,
      contextLimit: 200,
      percent: 25,
      source: "acp_usage_update",
      reportedAt: "t-context",
      cost: { amount: 1.5, currency: "USD" },
    },
    confirmedModel: {
      value: "model-x",
      source: "plan",
      reportedAt: "t-model",
    },
    confirmedReasoning: {
      value: "high",
      source: "adapter_selector",
      reportedAt: "t-reasoning",
    },
    workspace: {
      directory: "/work",
      git: { state: "branch", branch: "main" },
      checkedAt: "t-workspace",
    },
    updatedAt: "t-updated",
  });
});

it("reads an attempt without optional values", () => {
  const record = readAttemptRow(
    attemptRow({
      5: "zai",
      7: null,
      9: null,
      10: null,
      11: "unknown_source",
      12: null,
      13: null,
      14: null,
      16: null,
      19: null,
      24: null,
      25: null,
      26: null,
      27: null,
      28: null,
    }),
  );
  expect(record).toMatchObject({
    provider: "opencode",
    connectionId: undefined,
    agentId: undefined,
    requestedModel: undefined,
    groupId: null,
    context: {
      contextUsed: null,
      contextLimit: null,
      percent: null,
      source: null,
      cost: null,
    },
    confirmedModel: { value: null, source: null, reportedAt: null },
    workspace: null,
  });
});

it("reads a reported value without a source", () => {
  const record = readAttemptRow(attemptRow({ 14: null }));
  expect(record.confirmedModel).toEqual({
    value: "model-x",
    source: null,
    reportedAt: "t-model",
  });
});

it("reads the numeric cost and rejects incomplete costs", () => {
  expect(readAttemptRow(attemptRow({ 24: 2 })).context.cost).toEqual({
    amount: 2,
    currency: "USD",
  });
  expect(readAttemptRow(attemptRow({ 24: "abc" })).context.cost).toBeNull();
  expect(readAttemptRow(attemptRow({ 25: "" })).context.cost).toBeNull();
  expect(
    readAttemptRow(attemptRow({ 24: Buffer.alloc(0) })).context.cost,
  ).toBeNull();
});

it("gives a zero context limit no percentage", () => {
  const record = readAttemptRow(attemptRow({ 10: 0 }));
  expect(record.context.percent).toBeNull();
});

it("reads every Git state of the workspace", () => {
  const gitOf = (
    state: DatabaseValue,
    reference: DatabaseValue,
  ): AgentSessionGitState | undefined =>
    readAttemptRow(attemptRow({ 20: state, 21: reference })).workspace?.git;
  expect(gitOf("detached", "abc")).toEqual({
    state: "detached",
    commit: "abc",
  });
  expect(gitOf("no_repository", null)).toEqual({ state: "no_repository" });
  expect(gitOf("other", null)).toEqual({ state: "unreadable" });
  expect(gitOf("branch", null)).toEqual({ state: "branch", branch: "" });
});

it("rejects invalid enumerated attempt columns", () => {
  expect(() => readAttemptRow(attemptRow({ 5: "nope" }))).toThrow(
    'invalid value for "provider"',
  );
  expect(() => readAttemptRow(attemptRow({ 8: "nope" }))).toThrow(
    'invalid value for "state"',
  );
  expect(() => readAttemptRow(attemptRow({ 14: "nope" }))).toThrow(
    'invalid value for "confirmed_source"',
  );
});

const EVENT_ROW: DatabaseValue[] = [
  3,
  null,
  "plan",
  "text",
  1,
  "t-event",
  "s1",
  null,
];

it("reads an event", () => {
  expect(readEventRow(EVENT_ROW, "a1")).toEqual({
    id: "a1:3",
    sequence: 3,
    turn: null,
    kind: "plan",
    text: "text",
    isTruncated: true,
    createdAt: "t-event",
    stepId: "s1",
    attemptId: "a1",
  });
  expect(readEventRow([3, 2, "plan", "", 0, "t", "s"], "a1").turn).toBe(2);
});

it("rejects an event of an unknown kind", () => {
  expect(() => readEventRow([1, 0, "nope", "", 0, "t", "s"], "a1")).toThrow(
    'invalid value for "kind"',
  );
});

it("resolves the body file of a stored event", async () => {
  const access = {};
  const event = await readStoredEventRow(
    access,
    [...EVENT_ROW.slice(0, 7), "ref"],
    "a1",
  );
  expect(event.text).toBe("file:ref");
  expect(readAgentPayload).toHaveBeenCalledWith(access, "text", "ref");
  const inline = await readStoredEventRow(access, EVENT_ROW, "a1");
  expect(inline.text).toBe("text");
});

function usageRow(
  overrides: Record<number, DatabaseValue> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    4,
    "claude_code",
    "m1",
    1,
    2,
    3,
    4,
    10,
    1,
    0,
    "t-usage",
    5,
    null,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("reads the usage of a turn", () => {
  expect(readUsageRow(usageRow())).toEqual({
    stepId: undefined,
    attemptId: "a1",
    turn: 4,
    provider: "claude_code",
    model: "m1",
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
    totalTokens: 10,
    inputIncludesCache: true,
    isPartial: false,
    reportedAt: "t-usage",
    reasoningTokens: 5,
  });
});

it("reads null counters and the step of a run usage", () => {
  const usage = readUsageRow(
    usageRow({ 3: null, 4: null, 9: null, 12: null, 15: "s9" }),
  );
  expect(usage).toMatchObject({
    stepId: "s9",
    model: null,
    inputTokens: null,
    inputIncludesCache: null,
    reasoningTokens: null,
  });
});

it("parses stored accountings", () => {
  const claude = {
    sessionId: "s",
    subscription: false,
    models: [],
    costUsd: 1,
  };
  const codex = { costUsd: null, isSubscription: true, price: null };
  const usage = readUsageRow(
    usageRow({ 13: JSON.stringify(codex), 14: JSON.stringify(claude) }),
  );
  expect(usage.claudeAccounting).toEqual(claude);
  expect(usage.accounting).toEqual(codex);
});

function openRouterRow(
  overrides: Record<number, DatabaseValue> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    1,
    "m1",
    1,
    2,
    3,
    4,
    5,
    "t-reported",
    0.5,
    "0.25",
    "known",
    "{}",
    "t-priced",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("reads a native OpenRouter usage", () => {
  expect(readOpenRouterUsageRow(openRouterRow())).toEqual({
    attemptId: "a1",
    turn: 1,
    provider: "opencode",
    model: "m1",
    inputTokens: 1,
    outputTokens: 2,
    reasoningTokens: 3,
    cacheReadTokens: 4,
    cacheWriteTokens: 5,
    totalTokens: 15,
    inputIncludesCache: false,
    isPartial: false,
    costAmount: 0.25,
    costState: "known",
    priceSnapshot: "{}",
    pricedAt: "t-priced",
    reportedAt: "t-reported",
  });
});

it("reads a native usage without cost or price", () => {
  const usage = readOpenRouterUsageRow(
    openRouterRow({ 10: null, 11: "free", 12: null, 13: null }),
  );
  expect(usage).toMatchObject({
    costAmount: null,
    costState: "free",
    priceSnapshot: null,
    pricedAt: null,
  });
  expect(readOpenRouterUsageRow(openRouterRow({ 10: 3 })).costAmount).toBe(3);
  expect(
    readOpenRouterUsageRow(openRouterRow({ 11: "unknown" })).costState,
  ).toBe("unknown");
});

it("rejects an invalid native cost state", () => {
  expect(() => readOpenRouterUsageRow(openRouterRow({ 11: "paid" }))).toThrow(
    "Invalid OpenRouter cost state",
  );
});

it("reads a message", () => {
  const row: DatabaseValue[] = [
    "m1",
    "a1",
    "u1",
    "repair",
    "body",
    "queued",
    "t1",
    "t2",
  ];
  expect(readMessageRow(row)).toEqual({
    id: "m1",
    attemptId: "a1",
    userId: "u1",
    kind: "repair",
    text: "body",
    status: "queued",
    createdAt: "t1",
    updatedAt: "t2",
  });
  expect(readMessageRow([...row.slice(0, 3), "x", ...row.slice(4)]).kind).toBe(
    "instruction",
  );
  expect(() =>
    readMessageRow([...row.slice(0, 5), "nope", ...row.slice(6)]),
  ).toThrow('invalid value for "status"');
});
