import { describe, expect, it, vi } from "vitest";

import {
  readPlanContract,
  readPlanSessionRecord,
} from "@/backend/agents/AgentPlanSessionInput";
import { AgentError } from "@/backend/error/AgentErrors";

vi.mock("@/backend/agents/AgentPlanWorkInput", () => ({
  readCompletionGate: (input: unknown) => ({ gate: input }),
}));

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const DIGEST = "a".repeat(64);

function base(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runner: "codex_cli",
    mode: "one_shot",
    instanceId: "instance",
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: "codex_cli",
      connectionId: "c",
      connectionName: "n",
      model: "m",
      reasoningEffort: null,
      options: null,
      unattended: "u",
      mcp: true,
      directory: null,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    ...overrides,
  };
}

function read(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof readPlanSessionRecord> {
  return readPlanSessionRecord(base(overrides));
}

function expectInvalid(overrides: Record<string, unknown>): void {
  expect(() => read(overrides)).toThrow(AgentError);
}

describe("readPlanSessionRecord", () => {
  it("returns null for a step without a record", () => {
    expect(readPlanSessionRecord(null)).toBeNull();
    expect(readPlanSessionRecord(undefined)).toBeNull();
  });

  it("reads a minimal record", () => {
    expect(read()).toMatchObject({
      runner: "codex_cli",
      mode: "one_shot",
      closeout: "pending",
      contract: null,
      events: [],
    });
  });

  it("reads a record with every optional part", () => {
    const record = read({
      runner: "api",
      attemptId: "attempt",
      todoReturns: 2,
      providerFailure: { code: "provider_unreachable", resetAt: null },
      retry: {
        state: "completed",
        reason: "transient",
        nextAttemptAt: null,
        resetAt: null,
        attempts: [
          {
            attemptId: null,
            sessionId: null,
            endedAt: "2026-01-01T00:00:00.000Z",
            code: "x",
          },
        ],
      },
      dispatchedPromptDigest: DIGEST,
      continuationCapabilities: {
        canResume: true,
        canLoad: false,
        adapter: "a",
      },
      effects: { tools: "observed", calls: 3 },
      runnerOwned: true,
      runnerJob: { connectionId: UUID, jobId: UUID, attemptId: UUID },
      exit: { code: 1, signal: "SIGTERM" },
      effective: { long: "x".repeat(5000) },
      definition: { path: "p", revision: null },
      activity: { reportedAt: "t", titles: ["a"] },
      events: ["e"],
    });

    expect(record).toMatchObject({
      attemptId: "attempt",
      todoReturns: 2,
      effects: { tools: "observed", calls: 3 },
      runnerOwned: true,
      exit: { code: 1, signal: "SIGTERM" },
      definition: { path: "p", revision: 0 },
      activity: { reportedAt: "t", titles: ["a"] },
    });
    expect(record?.effective?.long).toHaveLength(4000);
  });

  it("reads definitions with a revision and plain effective values", () => {
    expect(
      read({ definition: { path: "p", revision: 4 }, effective: { a: "b" } }),
    ).toMatchObject({ definition: { revision: 4 }, effective: { a: "b" } });
  });

  it("keeps containment only for a confirmed closeout of a non api runner", () => {
    expect(
      read({ containment: "pid_namespace", closeout: "confirmed" }),
    ).toMatchObject({ containment: "pid_namespace" });
    expect(
      read({ containment: "pid_namespace", closeout: "failed" }),
    ).not.toHaveProperty("containment");
    expect(
      read({
        containment: "pid_namespace",
        closeout: "confirmed",
        runner: "api",
      }),
    ).not.toHaveProperty("containment");
    expect(read({ containment: "other" })).not.toHaveProperty("containment");
  });

  it("reads the supervisor namespace of an agent runner", () => {
    const namespace = { pid: 1, uid: 0, start: 0, boot: UUID, unit: "u" };

    expect(read({ namespace })).toMatchObject({ namespace });
  });

  it("refuses a namespace on an api runner or a damaged one", () => {
    expectInvalid({ runner: "api", namespace: {} });
    expectInvalid({ namespace: { pid: "x" } });
  });
});

describe("readPlanSessionRecord parts", () => {
  it("reads group, loop and event links", () => {
    const record = read({
      group: {
        groupId: "g",
        adapter: "opencode",
        role: "created",
        creatorStepId: "s",
        turn: 1,
        acpSessionId: "a",
      },
      loop: {
        loopId: "l",
        iteration: 2,
        policy: "reuse",
        role: "fresh",
        turn: 1,
        nativeSessionId: "n",
      },
      event: {
        activation: 1,
        role: "recovered",
        turn: 3,
        sourceStepId: "s",
      },
    });

    expect(record?.group?.nativeSessionId).toBeNull();
    expect(record?.loop?.acpSessionId).toBeNull();
    expect(record?.event?.acpSessionId).toBeNull();
    expect(record?.event?.sourceStepId).toBe("s");
  });

  it("ignores null links", () => {
    const record = read({ group: null, loop: null, event: null });

    expect(record).not.toHaveProperty("group");
    expect(record).not.toHaveProperty("loop");
    expect(record).not.toHaveProperty("event");
  });
});

describe("readPlanSessionRecord links", () => {
  const group = {
    groupId: "g",
    adapter: "opencode",
    role: "created",
    creatorStepId: "s",
    turn: 1,
  };
  const loop = {
    loopId: "l",
    iteration: 1,
    policy: "reuse",
    role: "created",
    turn: 1,
  };
  const event = { activation: 1, role: "created", turn: 1 };

  it.each([
    { group: { ...group, turn: null } },
    { group: { ...group, turn: 1.5 } },
    { group: { ...group, turn: 0 } },
    { group: { ...group, role: "x" } },
    { loop: { ...loop, turn: null } },
    { loop: { ...loop, turn: 1.5 } },
    { loop: { ...loop, turn: 0 } },
    { loop: { ...loop, iteration: null } },
    { loop: { ...loop, iteration: 1.5 } },
    { loop: { ...loop, iteration: 0 } },
    { event: { ...event, turn: null } },
    { event: { ...event, turn: 1.5 } },
    { event: { ...event, turn: 0 } },
    { event: { ...event, activation: null } },
    { event: { ...event, activation: 1.5 } },
    { event: { ...event, activation: 0 } },
  ])("rejects the damaged link %j", (overrides) => {
    expectInvalid(overrides);
  });

  it("accepts valid minimal links", () => {
    expect(read({ group, loop, event })).toMatchObject({
      group: { turn: 1 },
      loop: { iteration: 1 },
      event: { activation: 1 },
    });
  });

  it.each([
    { runner: "other" },
    { mode: "other" },
    { closeout: "other" },
    { instanceId: 1 },
    { resultCode: 1 },
    { processId: "x" },
    { processId: Number.NaN },
    { events: "x" },
    { events: Array(101).fill("e") },
    { events: [1] },
    { effects: { tools: "other", calls: 1 } },
    { effects: { tools: "none", calls: -1 } },
    { effects: { tools: "none", calls: 1.5 } },
    { effects: { tools: "none", calls: "1" } },
    { todoReturns: "1" },
    { todoReturns: 1.5 },
    { todoReturns: -1 },
    { todoReturns: 4 },
    { providerFailure: {} },
    { retry: {} },
    { activity: { reportedAt: "t", titles: "x" } },
    { requested: { ...(base().requested as object), mcp: "yes" } },
    { requested: { ...(base().requested as object), runner: "x" } },
  ])("rejects the damaged record %j", (overrides) => {
    expectInvalid(overrides);
  });

  it.each([
    { runnerOwned: false },
    { runnerJob: { connectionId: "x" } },
    { dispatchedPromptDigest: "short" },
    { continuationCapabilities: {} },
  ])("rejects the record %j with a validation error", (overrides) => {
    expect(() => read(overrides)).toThrow();
  });
});

describe("readPlanSessionRecord parts", () => {
  it("reads and rejects run options", () => {
    const requested = base().requested as Record<string, unknown>;
    const options = {
      access: "yolo",
      shell: true,
      web: false,
      timeoutMinutes: null,
      monthlyCostLimitUsd: 5,
      browser: true,
    };

    expect(
      read({ requested: { ...requested, options } })?.requested.options,
    ).toEqual({ ...options, timeoutMinutes: 0 });
    expect(
      read({
        requested: {
          ...requested,
          options: { ...options, browser: undefined, monthlyCostLimitUsd: "x" },
        },
      })?.requested.options,
    ).toEqual({ access: "yolo", shell: true, web: false, timeoutMinutes: 0 });
    expect(
      read({
        requested: { ...requested, options: { ...options, browser: 1 } },
      })?.requested.options,
    ).toMatchObject({ browser: false });
    expect(
      read({ requested: { ...requested, options: undefined } })?.requested
        .options,
    ).toBeNull();
    for (const bad of [
      { ...options, shell: "x" },
      { ...options, web: "x" },
      { ...options, access: "x" },
    ])
      expectInvalid({ requested: { ...requested, options: bad } });
  });

  it("reads a contract and an acceptance", () => {
    const record = read({
      contract: { todos: [], criteria: [], tickets: [] },
      acceptance: {
        verdict: "accepted",
        todos: [{ id: "t", status: "missing" }],
        criteria: [
          { id: "c", met: true, evidence: "e", ticketChecked: true },
          { id: "d", met: 0, evidence: "e" },
        ],
        decisions: ["d"],
        issues: [],
        summary: "s",
        message: "m",
      },
    });

    expect(record?.acceptance).toMatchObject({
      message: "m",
      criteria: [
        { met: true, ticketChecked: true },
        { met: false, ticketChecked: null },
      ],
    });
  });

  it("reads an acceptance without a message and rejects damaged ones", () => {
    const acceptance = {
      verdict: "open",
      todos: [],
      criteria: [],
      decisions: [],
      issues: [],
      summary: "s",
    };

    expect(read({ acceptance })?.acceptance).not.toHaveProperty("message");
    expectInvalid({ acceptance: { ...acceptance, todos: "x" } });
    expectInvalid({ acceptance: { ...acceptance, criteria: "x" } });
    expectInvalid({ acceptance: { ...acceptance, verdict: "x" } });
    expectInvalid({
      acceptance: { ...acceptance, decisions: Array(51).fill("") },
    });
  });
});

describe("readPlanContract", () => {
  it("returns null without a contract", () => {
    expect(readPlanContract(null)).toBeNull();
    expect(readPlanContract(undefined)).toBeNull();
  });

  it("reads items, tickets and the completion settings", () => {
    const contract = readPlanContract({
      completion: "todos",
      completionGate: "gate",
      todos: [
        {
          id: "t",
          text: "x",
          checked: 1,
          agent: true,
          ticket: { id: "i", key: "k", itemId: "n" },
        },
      ],
      criteria: [{ id: "c", text: "y", ticket: null }],
      tickets: [
        { id: "i", key: "k", title: "T", requirementsHash: "h" },
        { id: "j", key: "l" },
      ],
    });

    expect(contract).toEqual({
      completion: "todos",
      completionGate: { gate: "gate" },
      todos: [
        {
          id: "t",
          text: "x",
          checked: false,
          agent: true,
          ticket: { id: "i", key: "k", itemId: "n" },
        },
      ],
      criteria: [{ id: "c", text: "y", ticket: null }],
      tickets: [
        { id: "i", key: "k", title: "T", requirementsHash: "h" },
        { id: "j", key: "l" },
      ],
    });
  });

  it("rejects contracts without lists", () => {
    expect(() => readPlanContract({ todos: [], criteria: [] })).toThrow(
      AgentError,
    );
    expect(() => readPlanContract({ criteria: [], tickets: [] })).toThrow(
      AgentError,
    );
    expect(() => readPlanContract({ todos: [], tickets: [] })).toThrow(
      AgentError,
    );
  });
});
