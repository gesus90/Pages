import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(
    async (...parts: unknown[]) => `file:${String(parts[1]).length}`,
  ),
  prepareChunks: vi.fn(async () => ["chunk"]),
  appendChunks: vi.fn(async () => undefined),
  structured: vi.fn(async () => undefined),
  usage: vi.fn(async () => undefined),
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: mocks.write }),
}));
vi.mock("@/backend/service/agents/AgentPlanOutput", () => ({
  sanitizePlanOutput: (text: string) => text,
}));
vi.mock("./RunnerStructuredProgress", () => ({
  persistRunnerStructuredProgress: mocks.structured,
}));
vi.mock("./RunnerSessionUsage", () => ({
  persistRunnerSessionUsage: mocks.usage,
}));
vi.mock("../agent/AgentSessionHistoryChunks", () => ({
  prepareSessionHistoryChunks: mocks.prepareChunks,
  appendSessionHistoryChunks: mocks.appendChunks,
}));

import {
  appendRunnerSessionEvents,
  persistRunnerSessionEvents,
  prepareRunnerSessionEvents,
  runnerSessionState,
} from "./RunnerSessionEvents";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";

type Call = (...parameters: unknown[]) => Promise<undefined>;
type Read = (...parameters: unknown[]) => Promise<unknown[][]>;

const BINDING = {
  planId: "p1",
  runId: "r1",
  stepId: "s1",
  attemptId: "a1",
  planRevision: 1,
  managed: false,
} as unknown as RunnerPlanBinding;

function event(sequence: number, text = "hello"): RunnerLiveEvent {
  return {
    sequence,
    kind: "output",
    text,
    isTruncated: false,
    createdAt: "t",
  } as unknown as RunnerLiveEvent;
}

function transactionOf(attempt: unknown[][] = [["a1"]]): {
  transaction: DatabaseTransaction;
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<Call>(async () => undefined);
  const query = vi.fn<Read>(async () => attempt);
  return {
    transaction: { execute, query } as unknown as DatabaseTransaction,
    execute,
    query,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("prepareRunnerSessionEvents", () => {
  it("synchronizes bodies and skips chunks without a launch", async () => {
    const { transaction } = transactionOf();

    const prepared = await prepareRunnerSessionEvents(transaction, {
      binding: BINDING,
      jobId: "j1",
      events: [event(1, "a\u0000b".padEnd(5_000, "x"))],
    });

    expect(prepared.events[0]).toMatchObject({ id: "a1:1", turn: 1 });
    expect(mocks.write).toHaveBeenCalledWith(
      "p1",
      expect.stringMatching(/^abx/u),
    );
    expect(prepared.bodies[0]).toBe("file:3999");
    expect(prepared.chunks).toEqual([]);
  });

  it("prepares chunks of a launch and honors a recording binding", async () => {
    const { transaction } = transactionOf();
    const binding = {
      ...BINDING,
      managed: true,
      recordingAttemptId: "ra",
      historyBase: 10,
      turn: 3,
    } as unknown as RunnerPlanBinding;

    const prepared = await prepareRunnerSessionEvents(transaction, {
      binding,
      jobId: "j1",
      launchId: "l1",
      events: [event(1)],
    });

    expect(prepared.events[0]).toMatchObject({
      id: "ra:11",
      attemptId: "ra",
      turn: 3,
    });
    expect(prepared.chunks).toEqual(["chunk"]);
  });

  it("offsets a recording binding without a history base by zero", async () => {
    const { transaction } = transactionOf();
    const binding = {
      ...BINDING,
      managed: true,
      recordingAttemptId: "ra",
    } as unknown as RunnerPlanBinding;

    const prepared = await prepareRunnerSessionEvents(transaction, {
      binding,
      jobId: "j1",
      events: [event(2)],
    });

    expect(prepared.events[0]?.sequence).toBe(2);
  });

  it("leaves a managed binding without recording untouched", async () => {
    const { transaction } = transactionOf();

    const prepared = await prepareRunnerSessionEvents(transaction, {
      binding: { ...BINDING, managed: true } as unknown as RunnerPlanBinding,
      jobId: "j1",
      events: [event(2)],
    });

    expect(prepared.events[0]?.attemptId).toBe("a1");
  });
});

describe("runnerSessionState", () => {
  const step = (value: unknown): AgentPlanStepResult =>
    value as AgentPlanStepResult;

  it("maps the attested states", () => {
    expect(runnerSessionState(step({ status: "succeeded" }))).toBe("ended");
    for (const status of ["running", "failed", "cancelled"])
      expect(runnerSessionState(step({ status }))).toBe(status);
  });

  it("ends the never-spawned attempt of a queued pause", () => {
    expect(
      runnerSessionState(
        step({
          status: "paused",
          cancellation: "not_started",
          remote: { status: "interrupted", closeout: "confirmed" },
        }),
      ),
    ).toBe("cancelled");
  });

  it("refuses any other state", () => {
    expect(() => runnerSessionState(step({ status: "paused" }))).toThrow(
      "attested attempt state",
    );
  });
});

const prepared = { events: [], bodies: ["f1"], chunks: [] };

it("appends events and advances the sequence", async () => {
  const { transaction, execute } = transactionOf();

  await appendRunnerSessionEvents(transaction, {
    binding: BINDING,
    jobId: "j1",
    events: [event(1, "x".repeat(10))],
    prepared,
    hasTerminalUsage: true,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    body_file: "f1",
    is_truncated: false,
    turn: 1,
  });
  expect(mocks.structured).toHaveBeenCalledWith(
    transaction,
    expect.objectContaining({ hasTerminalUsage: true }),
  );
  expect(execute).toHaveBeenCalledTimes(2);
  expect(mocks.appendChunks).not.toHaveBeenCalled();
});

it("marks long events truncated and trims the old window", async () => {
  const { transaction, execute } = transactionOf();

  await appendRunnerSessionEvents(transaction, {
    binding: { ...BINDING, turn: 2 },
    jobId: "j1",
    events: [event(2_100, "x".repeat(4_001))],
    prepared,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    is_truncated: true,
    turn: 2,
  });
  expect(execute.mock.calls.at(-1)?.[1]).toEqual({
    attempt_id: "a1",
    first_kept: 101,
  });
  expect(mocks.structured).toHaveBeenCalledWith(
    transaction,
    expect.objectContaining({ hasTerminalUsage: false }),
  );
});

it("keeps an event the runner marked truncated", async () => {
  const { transaction, execute } = transactionOf();

  await appendRunnerSessionEvents(transaction, {
    binding: BINDING,
    jobId: "j1",
    events: [{ ...event(1), isTruncated: true }],
    prepared,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ is_truncated: true });
});

it("appends launch chunks, with an empty batch when nothing was prepared", async () => {
  const { transaction } = transactionOf();

  await appendRunnerSessionEvents(transaction, {
    binding: {
      ...BINDING,
      managed: true,
      recordingInstanceId: "ri",
    } as unknown as RunnerPlanBinding,
    jobId: "j1",
    launchId: "l1",
    events: [],
  });
  await appendRunnerSessionEvents(transaction, {
    binding: BINDING,
    jobId: "j1",
    launchId: "l1",
    events: [event(1)],
    prepared: { events: [{} as unknown as never], bodies: ["f"], chunks: [] },
  });

  expect(mocks.appendChunks).toHaveBeenCalledTimes(2);
  expect(mocks.appendChunks.mock.calls[0]?.slice(2)).toEqual([[], []]);
});

it("refuses an unknown binding", async () => {
  const { transaction } = transactionOf([]);

  await expect(
    appendRunnerSessionEvents(transaction, {
      binding: BINDING,
      jobId: "j1",
      events: [],
    }),
  ).rejects.toThrow("binding mismatch");
});

it("refuses events that were not synchronized", async () => {
  const { transaction } = transactionOf();

  await expect(
    appendRunnerSessionEvents(transaction, {
      binding: BINDING,
      jobId: "j1",
      events: [event(1)],
    }),
  ).rejects.toThrow("synchronized");
  await expect(
    appendRunnerSessionEvents(transaction, {
      binding: BINDING,
      jobId: "j1",
      events: [event(1)],
      prepared: { events: [], bodies: [], chunks: [] },
    }),
  ).rejects.toThrow("synchronized");
});

it("refuses a missing prepared body", async () => {
  const { transaction } = transactionOf();

  await expect(
    appendRunnerSessionEvents(transaction, {
      binding: BINDING,
      jobId: "j1",
      events: [event(1)],
      prepared: { events: [], bodies: [""], chunks: [] },
    }),
  ).rejects.toThrow("body missing");
});

describe("persistRunnerSessionEvents", () => {
  function runOf(step: unknown): AgentPlanRun {
    return {
      id: "r1",
      planId: "p1",
      userId: "u1",
      planRevision: 2,
      steps: [step],
    } as unknown as AgentPlanRun;
  }

  const session = {
    attemptId: "a1",
    runner: "codex_cli",
    instanceId: "j1",
    requested: { model: "m" },
  };

  it.each([
    ["an unknown step", { id: "other" }],
    [
      "a step without a session",
      { id: "s1", remote: { liveHistoryVersion: 1 } },
    ],
    [
      "a session without attempt",
      { id: "s1", session: {}, remote: { liveHistoryVersion: 1 } },
    ],
    ["a step without live history", { id: "s1", session, remote: {} }],
    ["a step without remote", { id: "s1", session }],
  ])("writes nothing for %s", async (...parts) => {
    const { transaction, execute } = transactionOf();

    await persistRunnerSessionEvents(transaction, runOf(parts[1]), {
      stepId: "s1",
      events: [],
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("records the attempt, its usage and events", async () => {
    const { transaction, execute } = transactionOf();
    const step = {
      id: "s1",
      status: "running",
      session,
      remote: {
        liveHistoryVersion: 1,
        outputJournalVersion: 2,
        launchId: "l1",
        terminal: { usage: { inputTokens: 5, outputTokens: null } },
      },
    };

    await persistRunnerSessionEvents(transaction, runOf(step), {
      stepId: "s1",
      events: [event(4)],
      prepared: { events: [], bodies: ["f"], chunks: [] },
    });

    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      attempt_id: "a1",
      next_sequence: 5,
      state: "running",
    });
    expect(mocks.usage).toHaveBeenCalledTimes(1);
    expect(mocks.appendChunks).toHaveBeenCalledTimes(1);
    expect(mocks.structured).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ hasTerminalUsage: true }),
    );
  });

  it("records an attempt without events, usage or launch", async () => {
    const { transaction, execute } = transactionOf();
    const step = {
      id: "s1",
      status: "running",
      session,
      remote: { liveHistoryVersion: 1 },
    };

    await persistRunnerSessionEvents(transaction, runOf(step), {
      stepId: "s1",
      events: [],
    });

    expect(execute.mock.calls[0]?.[1]).toMatchObject({ next_sequence: 1 });
    expect(mocks.appendChunks).not.toHaveBeenCalled();
    expect(mocks.structured).not.toHaveBeenCalled();
  });
});
