import { expect, it } from "vitest";

import { readPlanSessionRecord } from "@/backend/agents/AgentPlanSessionInput";

import { agentErrorCode } from "./agent-error-code";
import { DIGEST, sessionRecord } from "./agent-plan-record-fixture";

import type { RecordFields } from "./agent-plan-record-fixture";

const ITEM = {
  id: "1",
  text: "Do it",
  ticket: { id: "t", key: "K-1", itemId: "i" },
};

const REQUESTED = {
  runner: "claude_code",
  connectionId: "connection",
  connectionName: "Claude",
  model: "sonnet",
  reasoningEffort: "high",
  options: {
    access: "yolo",
    shell: true,
    web: false,
    timeoutMinutes: 5,
    browser: true,
  },
  unattended: "always",
  mcp: true,
  directory: "/work",
};

const FULL = sessionRecord({
  runner: "claude_code",
  mode: "interactive",
  attemptId: "attempt",
  dispatchedPromptDigest: DIGEST,
  continuationCapabilities: { canResume: true, canLoad: false, adapter: "acp" },
  providerFailure: { code: "provider_rate_limited", resetAt: null },
  retry: {
    state: "blocked",
    reason: "quota",
    nextAttemptAt: null,
    resetAt: null,
    attempts: [
      {
        attemptId: null,
        sessionId: null,
        endedAt: "2026-10-20T10:00:00Z",
        code: "provider_quota_exhausted",
      },
    ],
  },
  sessionId: "x".repeat(5_000),
  processId: 12,
  startedAt: "start",
  turnEndedAt: "turn",
  endedAt: "end",
  exit: { code: 0, signal: "SIGTERM" },
  leftoverProcesses: 0,
  resultCode: -1,
  requested: REQUESTED,
  effective: { model: "sonnet" },
  definition: { path: "/work/AGENT.md", revision: 3 },
  contract: {
    completion: "todos",
    completionGate: { version: 1, requiredChecks: ["lint"] },
    todos: [ITEM],
    criteria: [{ ...ITEM, ticket: null }],
    tickets: [
      { id: "t", key: "K-1", requirementsHash: "h" },
      { id: "u", key: "K-2" },
    ],
  },
  acceptance: {
    verdict: "accepted",
    todos: [{ id: "1", status: "done" }],
    criteria: [
      { id: "1", met: true, evidence: "seen", ticketChecked: true },
      { id: "2", met: "yes", evidence: "", ticketChecked: "no" },
    ],
    decisions: ["d"],
    issues: [],
    summary: "ok",
  },
  events: ["started"],
  activity: { reportedAt: "now", titles: ["Reading"] },
  group: {
    groupId: "g",
    adapter: "opencode",
    role: "created",
    creatorStepId: "s",
    turn: 1,
    acpSessionId: "acp",
    nativeSessionId: null,
  },
  loop: {
    loopId: "l",
    iteration: 2,
    policy: "fresh",
    role: "fresh",
    turn: 1,
    acpSessionId: null,
    nativeSessionId: "native",
  },
});

it("reads no record for older steps", () => {
  expect(readPlanSessionRecord(null)).toBeNull();
  expect(readPlanSessionRecord(undefined)).toBeNull();
});

it("reads a minimal record with empty optional parts", () => {
  expect(
    readPlanSessionRecord(
      sessionRecord({ attemptId: 7, group: null, loop: null }),
    ),
  ).toEqual({
    runner: "codex_cli",
    mode: "one_shot",
    instanceId: "instance",
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "confirmed",
    leftoverProcesses: null,
    resultCode: 0,
    requested: {
      runner: "codex_cli",
      connectionId: "connection",
      connectionName: "Codex",
      model: "gpt-5",
      reasoningEffort: null,
      options: null,
      unattended: "never",
      mcp: false,
      directory: null,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
  });
});

it("reads every optional part and cuts long texts", () => {
  const record = readPlanSessionRecord(FULL);
  expect(record).toMatchObject({
    runner: "claude_code",
    attemptId: "attempt",
    dispatchedPromptDigest: DIGEST,
    continuationCapabilities: { canResume: true },
    providerFailure: { code: "provider_rate_limited" },
    retry: { state: "blocked" },
    exit: { code: 0, signal: "SIGTERM" },
    resultCode: -1,
    requested: { options: { access: "yolo", browser: true }, mcp: true },
    effective: { model: "sonnet" },
    definition: { path: "/work/AGENT.md", revision: 3 },
    contract: {
      completion: "todos",
      completionGate: { version: 1, requiredChecks: ["lint"] },
      todos: [ITEM],
      criteria: [{ ...ITEM, ticket: null }],
      tickets: [
        { id: "t", key: "K-1", requirementsHash: "h" },
        { id: "u", key: "K-2" },
      ],
    },
    acceptance: {
      criteria: [
        { id: "1", met: true, ticketChecked: true },
        { id: "2", met: false, ticketChecked: null },
      ],
    },
    activity: { titles: ["Reading"] },
    group: { adapter: "opencode", turn: 1 },
    loop: { iteration: 2, nativeSessionId: "native" },
  });
  expect(record?.sessionId).toHaveLength(4_000);
});

it("defaults a missing timeout and definition revision to zero", () => {
  const record = readPlanSessionRecord(
    sessionRecord({
      requested: {
        ...REQUESTED,
        options: { access: "read_only", shell: false, web: true },
      },
      definition: { path: "/AGENT.md", revision: null },
      contract: { todos: [], criteria: [], tickets: [], completion: "report" },
    }),
  );
  expect(record?.requested.options).toEqual({
    access: "read_only",
    shell: false,
    web: true,
    timeoutMinutes: 0,
  });
  expect(record?.definition).toEqual({ path: "/AGENT.md", revision: 0 });
  expect(record?.contract).toEqual({ todos: [], criteria: [], tickets: [] });
});

it.each<[string, RecordFields]>([
  ["an unknown result code", { resultCode: 2 }],
  ["an unknown runner", { runner: "gemini" }],
  ["an instance that is no text", { instanceId: 1 }],
  ["a process id that is no number", { processId: "12" }],
  ["an infinite process id", { processId: Number.POSITIVE_INFINITY }],
  ["events that are no list", { events: null }],
  ["more than 100 events", { events: Array.from({ length: 101 }, () => "e") }],
  ["a request without MCP flag", { requested: { ...REQUESTED, mcp: "no" } }],
  [
    "options without flags",
    { requested: { ...REQUESTED, options: { access: "yolo" } } },
  ],
  ["a contract without lists", { contract: { todos: [], criteria: [] } }],
  ["an acceptance without lists", { acceptance: { todos: [] } }],
  [
    "an acceptance with an unknown verdict",
    { acceptance: { todos: [], criteria: [], verdict: "maybe" } },
  ],
  ["an activity without titles", { activity: { reportedAt: "now" } }],
  ["a group link without a turn", { group: { groupId: "g" } }],
  ["a group link with turn zero", { group: { turn: 0 } }],
  ["a group link with a fractional turn", { group: { turn: 1.5 } }],
  ["a loop link without a turn", { loop: { iteration: 1 } }],
  ["a loop link with turn zero", { loop: { turn: 0, iteration: 1 } }],
  ["a loop link with a fractional turn", { loop: { turn: 1.5, iteration: 1 } }],
  ["a loop link without an iteration", { loop: { turn: 1 } }],
  ["a loop link with iteration zero", { loop: { turn: 1, iteration: 0 } }],
  [
    "a loop link with a fractional iteration",
    { loop: { turn: 1, iteration: 0.5 } },
  ],
  ["an effective value that is no text", { effective: { model: 1 } }],
])("refuses a record with %s", (scenario, change) => {
  expect(
    agentErrorCode(() => readPlanSessionRecord(sessionRecord(change))),
  ).toBe("plan_invalid");
});

it("refuses malformed retry metadata", () => {
  expect(
    agentErrorCode(() =>
      readPlanSessionRecord(sessionRecord({ providerFailure: { code: "x" } })),
    ),
  ).toBe("plan_invalid");
});
