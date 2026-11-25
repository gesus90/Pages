import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AUTOMATION_ANSWER_BYTES } from "@/definition/Automation";

import {
  AutomationAgentBusyError,
  AutomationAgentWorker,
} from "./AutomationAgentWorker";

import type {
  AutomationAgentRunner,
  AutomationAgentTurn,
  AutomationAgentWorkerDependencies,
} from "./AutomationAgentWorker";
import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";

const mocks = vi.hoisted(() => ({
  heads: vi.fn(),
  interrupted: vi.fn(),
  finish: vi.fn(),
  deliverJob: vi.fn(),
  findAutomation: vi.fn(),
  deliverRun: vi.fn(),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (name: string, work: () => Promise<void>) =>
    work(),
}));
vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: vi.fn(function Repository() {
      return {
        heads: mocks.heads,
        interrupted: mocks.interrupted,
        finish: mocks.finish,
        deliver: mocks.deliverJob,
      };
    }),
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: vi.fn(function Repository() {
      return { find: mocks.findAutomation };
    }),
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: vi.fn(function Repository() {
      return { deliver: mocks.deliverRun };
    }),
  }),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: mocks.logEvent,
}));

const NOW = new Date("2026-01-01T00:00:00.000Z");

function job(
  overrides: Partial<StoredAutomationAgentJob> = {},
): StoredAutomationAgentJob {
  return {
    id: "job-1",
    runId: "run-1",
    automationId: "auto-1",
    agentId: "agent-1",
    creatorId: "user-1",
    kind: "action",
    prompt: "Do it",
    state: "queued",
    answer: null,
    errorCode: null,
    sessionId: null,
    queuedAt: NOW.toISOString(),
    deliveredAt: null,
    completedAt: null,
    ...overrides,
  };
}

interface Setup {
  readonly worker: AutomationAgentWorker;
  readonly start: ReturnType<typeof vi.fn>;
  readonly find: ReturnType<typeof vi.fn>;
  readonly canUseAgent: ReturnType<typeof vi.fn>;
  readonly account: ReturnType<typeof vi.fn>;
}

function setup(extra: Partial<AutomationAgentWorkerDependencies> = {}): Setup {
  const start = vi.fn((): Promise<AutomationAgentTurn> =>
    Promise.resolve({ sessionId: "s1", answer: Promise.resolve("done") }),
  );
  const find = vi.fn().mockResolvedValue(null);
  const account = vi.fn().mockResolvedValue({ id: "user-1" });
  const canUseAgent = vi.fn().mockResolvedValue(true);
  const dependencies = {
    database: { query: vi.fn(), execute: vi.fn() },
    rules: { account, canUseAgent },
    runner: { start } satisfies AutomationAgentRunner,
    now: () => NOW,
    chatTasks: { find },
    ...extra,
  } as unknown as AutomationAgentWorkerDependencies;
  return {
    worker: new AutomationAgentWorker(dependencies),
    start,
    find,
    canUseAgent,
    account,
  };
}

async function pass(worker: AutomationAgentWorker): Promise<void> {
  await worker.pass();
  await vi.waitFor(() => {
    expect(
      mocks.finish.mock.calls.length + mocks.logEvent.mock.calls.length,
    ).toBeGreaterThan(0);
  });
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.heads.mockResolvedValue([job()]);
  mocks.interrupted.mockResolvedValue([]);
  mocks.deliverJob.mockResolvedValue(true);
  mocks.finish.mockResolvedValue(undefined);
  mocks.deliverRun.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

it("delivers a job and stores its answer", async () => {
  const { worker, start } = setup();
  await pass(worker);
  expect(start).toHaveBeenCalledWith({
    agentId: "agent-1",
    creatorId: "user-1",
    sessionKey: "automation:auto-1",
    prompt: "Do it",
    chat: null,
    runKey: "run-1",
  });
  expect(mocks.deliverRun).toHaveBeenCalledWith("run-1", null);
  expect(mocks.finish).toHaveBeenCalledWith("job-1", {
    state: "completed",
    answer: "done",
    errorCode: null,
    completedAt: NOW.toISOString(),
  });
});

it("cuts a long answer", async () => {
  const { worker, start } = setup();
  start.mockResolvedValue({
    sessionId: "s1",
    answer: Promise.resolve("a".repeat(AUTOMATION_ANSWER_BYTES + 10)),
  });
  await pass(worker);
  const stored = mocks.finish.mock.calls[0]?.[1] as { answer: string };
  expect(stored.answer).toHaveLength(AUTOMATION_ANSWER_BYTES);
});

it("fails a job whose creator is unknown", async () => {
  const { worker, account, start } = setup();
  account.mockResolvedValue(null);
  await pass(worker);
  expect(start).not.toHaveBeenCalled();
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    state: "failed",
    errorCode: "forbidden",
  });
});

it("fails a job whose creator may not use the agent", async () => {
  const { worker, canUseAgent } = setup();
  canUseAgent.mockResolvedValue(false);
  await pass(worker);
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    errorCode: "forbidden",
  });
});

it("lets a busy agent rest and skips it until the pause ends", async () => {
  const { worker, start } = setup();
  start.mockRejectedValue(new AutomationAgentBusyError());
  await worker.pass();
  await vi.waitFor(() => {
    expect(start).toHaveBeenCalledTimes(1);
  });
  await new Promise((resolve) => setImmediate(resolve));
  await worker.pass();
  expect(start).toHaveBeenCalledTimes(1);
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(new AutomationAgentBusyError().name).toBe("AutomationAgentBusyError");
});

it("skips an agent that is working", async () => {
  const { worker, start } = setup();
  let release: (turn: AutomationAgentTurn) => void = () => undefined;
  start.mockReturnValue(
    new Promise<AutomationAgentTurn>((resolve) => {
      release = resolve;
    }),
  );
  await worker.pass();
  await vi.waitFor(() => {
    expect(start).toHaveBeenCalledTimes(1);
  });
  await worker.pass();
  expect(start).toHaveBeenCalledTimes(1);
  release({ sessionId: "s", answer: Promise.resolve("ok") });
  await vi.waitFor(() => {
    expect(mocks.finish).toHaveBeenCalled();
  });
});

it("fails a job with the code of a failing start", async () => {
  const { worker, start } = setup();
  start.mockRejectedValue(
    Object.assign(new Error("x"), { code: "c".repeat(100) }),
  );
  await pass(worker);
  expect(mocks.logCaughtError).toHaveBeenCalled();
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    errorCode: "c".repeat(80),
  });
});

it("uses a generic code for other failures", async () => {
  const { worker, start } = setup();
  start.mockRejectedValueOnce(new Error("plain"));
  await pass(worker);
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    errorCode: "agent_failed",
  });
  mocks.finish.mockClear();
  mocks.heads.mockResolvedValue([job({ agentId: "agent-2" })]);
  start.mockRejectedValueOnce(Object.assign(new Error("n"), { code: 5 }));
  await pass(worker);
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    errorCode: "agent_failed",
  });
  mocks.finish.mockClear();
  mocks.heads.mockResolvedValue([job({ agentId: "agent-3" })]);
  start.mockRejectedValueOnce("text");
  await pass(worker);
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    errorCode: "agent_failed",
  });
});

it("stops when the delivery was not stored", async () => {
  const { worker } = setup();
  mocks.deliverJob.mockResolvedValue(false);
  await worker.pass();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(mocks.logEvent).not.toHaveBeenCalled();
});

it("fails a job when the answer rejects", async () => {
  const { worker, start } = setup();
  const answer = Promise.reject(new Error("boom"));
  answer.catch(() => undefined);
  start.mockResolvedValue({ sessionId: "s", answer });
  await pass(worker);
  expect(mocks.finish.mock.calls[0]?.[1]).toMatchObject({
    state: "failed",
    errorCode: "agent_failed",
  });
});

it("does not mark a run for a notification and uses its session key", async () => {
  const { worker, start } = setup();
  mocks.heads.mockResolvedValue([
    job({ kind: "notification", runId: null, automationId: null }),
  ]);
  await pass(worker);
  expect(mocks.deliverRun).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionKey: "automation-notice:job-1",
      chat: null,
      runKey: "job-1",
    }),
  );
});

it("does not mark a run of an action without a run", async () => {
  const { worker } = setup();
  mocks.heads.mockResolvedValue([job({ runId: null })]);
  await pass(worker);
  expect(mocks.deliverRun).not.toHaveBeenCalled();
});

it("binds a task to its group chat", async () => {
  const { worker, find, start } = setup();
  find.mockResolvedValue({ chat: { kind: "group", conversationId: "c1" } });
  await pass(worker);
  expect(find).toHaveBeenCalledWith("auto-1");
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ chat: null, conversationId: "c1" }),
  );
});

it("binds a task to a direct chat", async () => {
  const { worker, find, start } = setup();
  find.mockResolvedValue({ chat: { kind: "direct" } });
  await pass(worker);
  const request = start.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(request[0]).toMatchObject({ chat: null });
  expect(request[0]).not.toHaveProperty("conversationId");
});

it("uses the target chat of the agent action", async () => {
  const { worker, start } = setup();
  mocks.findAutomation.mockResolvedValue({
    action: { type: "agent", chat: "@Ada" },
  });
  await pass(worker);
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ chat: "@Ada" }));
});

it("uses no chat for an agent action without a chat or another action", async () => {
  const { worker, start } = setup({ chatTasks: undefined });
  mocks.findAutomation.mockResolvedValueOnce({ action: { type: "agent" } });
  await pass(worker);
  expect(start).toHaveBeenLastCalledWith(
    expect.objectContaining({ chat: null }),
  );
  mocks.heads.mockResolvedValue([job({ agentId: "agent-2" })]);
  mocks.findAutomation.mockResolvedValueOnce({ action: { type: "script" } });
  await pass(worker);
  expect(start).toHaveBeenLastCalledWith(
    expect.objectContaining({ chat: null }),
  );
});

it("fails the interrupted turns on start and runs passes by timer", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.interrupted.mockResolvedValue([job({ id: "old" })]);
  mocks.heads.mockResolvedValue([]);
  const { worker } = setup({ tickMilliseconds: 500 });
  await worker.start();
  expect(mocks.finish).toHaveBeenCalledWith("old", {
    state: "failed",
    answer: null,
    errorCode: "interrupted",
    completedAt: NOW.toISOString(),
  });
  await worker.start();
  expect(mocks.interrupted).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.heads.mock.calls.length).toBeGreaterThanOrEqual(2);
  worker.stop();
  worker.stop();
});

it("uses the default tick and does not overlap wakes", async () => {
  vi.useFakeTimers();
  mocks.heads.mockResolvedValue([]);
  const { worker } = setup();
  await worker.start();
  worker.wake();
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.heads).toHaveBeenCalled();
  worker.stop();
});

it("logs a failing pass", async () => {
  vi.useFakeTimers();
  mocks.heads.mockRejectedValue(new Error("db"));
  const { worker } = setup();
  worker.wake();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.logCaughtError).toHaveBeenCalled();
});

it("logs a failing delivery", async () => {
  const { worker, account } = setup();
  account.mockRejectedValue(new Error("db"));
  await worker.pass();
  await vi.waitFor(() => {
    expect(mocks.logCaughtError).toHaveBeenCalled();
  });
});
