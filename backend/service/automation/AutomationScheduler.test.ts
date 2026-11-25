import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationScheduler } from "./AutomationScheduler";

import { AUTOMATION_NOTIFICATION_MODES } from "@/definition/Automation";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationEventIntake } from "./AutomationEventIntake";
import type { AutomationRunExecutor } from "./AutomationRunExecutor";

const mocks = vi.hoisted(() => ({
  due: vi.fn(),
  lock: vi.fn(),
  replace: vi.fn(),
  schedule: vi.fn(),
  enqueue: vi.fn(),
  startable: vi.fn(),
  claim: vi.fn(),
  open: vi.fn(),
  pruneEnded: vi.fn(),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  nextRunAfter: vi.fn(),
  withBackgroundDatabaseWork: vi.fn(),
}));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: mocks.withBackgroundDatabaseWork,
}));
vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: vi.fn(function Repository() {
      return { pruneEnded: mocks.pruneEnded };
    }),
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: vi.fn(function Repository() {
      return {
        due: mocks.due,
        lock: mocks.lock,
        replace: mocks.replace,
        schedule: mocks.schedule,
      };
    }),
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: vi.fn(function Repository() {
      return {
        enqueue: mocks.enqueue,
        startable: mocks.startable,
        claim: mocks.claim,
        open: mocks.open,
      };
    }),
  }),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: mocks.logEvent,
}));
vi.mock("./AutomationSchedule", () => ({
  nextRunAfter: mocks.nextRunAfter,
}));

const NOW = new Date("2026-11-25T10:00:00.000Z");
const TRANSACTION = { name: "transaction" };

const intake = { process: vi.fn() };
const executor = {
  abortAll: vi.fn(),
  isExecuting: vi.fn(),
  start: vi.fn(),
  settle: vi.fn(),
};
const database = {
  query: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
};

function createScheduler(tickMilliseconds?: number): AutomationScheduler {
  return new AutomationScheduler({
    database,
    executor: executor as unknown as AutomationRunExecutor,
    intake: intake as unknown as AutomationEventIntake,
    now: () => NOW,
    tickMilliseconds,
  });
}

function automation(overrides: Partial<StoredAutomation>): StoredAutomation {
  const base: StoredAutomation = {
    id: "automation-1",
    creatorId: "user-1",
    name: "Automation",
    trigger: { type: "manual" },
    action: {
      type: "script",
      workspaceId: "workspace-1",
      interpreterProfileId: "profile-1",
      content: null,
      timeoutSeconds: 60,
    },
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: AUTOMATION_NOTIFICATION_MODES[0] },
    nextRunAt: "2026-11-25T09:00:00.000Z",
    revision: 3,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.withBackgroundDatabaseWork.mockImplementation(
    (jobName: string, work: () => Promise<void>) => work(),
  );
  intake.process.mockResolvedValue(undefined);
  executor.isExecuting.mockReturnValue(false);
  executor.start.mockResolvedValue(undefined);
  executor.settle.mockResolvedValue(undefined);
  database.transaction.mockImplementation(
    (work: (transaction: unknown) => Promise<void>) => work(TRANSACTION),
  );
  mocks.due.mockResolvedValue([]);
  mocks.startable.mockResolvedValue([]);
  mocks.open.mockResolvedValue([]);
  mocks.enqueue.mockResolvedValue(undefined);
  mocks.replace.mockResolvedValue(undefined);
  mocks.schedule.mockResolvedValue(undefined);
  mocks.pruneEnded.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("start, wake and stop", () => {
  it("starts once, logs and runs a pass at every tick", async () => {
    const scheduler = createScheduler();
    scheduler.start();
    scheduler.start();
    await flush();
    expect(mocks.logEvent).toHaveBeenCalledTimes(1);
    expect(intake.process).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(intake.process).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("uses a custom tick", async () => {
    const scheduler = createScheduler(50);
    scheduler.start();
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(intake.process).toHaveBeenCalledTimes(3);
    await scheduler.stop();
  });

  it("repeats once after a pass when woken during it", async () => {
    const scheduler = createScheduler(100_000);
    scheduler.start();
    scheduler.wake();
    scheduler.wake();
    await flush();
    await flush();
    expect(intake.process).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("does not repeat when it was never started", async () => {
    const scheduler = createScheduler();
    scheduler.wake();
    scheduler.wake();
    await flush();
    expect(intake.process).toHaveBeenCalledTimes(1);
  });

  it("logs a failing pass", async () => {
    const failure = new Error("no database");
    mocks.withBackgroundDatabaseWork.mockRejectedValueOnce(failure);
    const scheduler = createScheduler();
    scheduler.wake();
    await flush();
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationScheduler",
      failure,
    );
  });

  it("stops without having started", async () => {
    const scheduler = createScheduler();
    await scheduler.stop();
    expect(executor.abortAll).toHaveBeenCalledTimes(1);
  });

  it("stops the timer and waits for passes and runs", async () => {
    let finishRun: () => void = () => undefined;
    executor.start.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRun = resolve;
      }),
    );
    mocks.startable.mockResolvedValue([{ id: "run-1" }]);
    mocks.claim.mockResolvedValue(true);
    const scheduler = createScheduler();
    scheduler.start();
    await flush();
    let isStopped = false;
    const stopping = scheduler.stop().then(() => {
      isStopped = true;
    });
    await flush();
    expect(isStopped).toBe(false);
    finishRun();
    await stopping;
    expect(isStopped).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(intake.process).toHaveBeenCalledTimes(1);
  });
});

describe("pass", () => {
  it("logs a failing step and runs the others", async () => {
    const failure = new Error("intake");
    intake.process.mockRejectedValue(failure);
    await createScheduler().pass();
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationScheduler",
      failure,
    );
    expect(mocks.due).toHaveBeenCalledTimes(1);
    expect(mocks.startable).toHaveBeenCalledTimes(1);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.pruneEnded).toHaveBeenCalledTimes(1);
  });
});

describe("firing due automations", () => {
  it("queues a run and plans the next time of an interval", async () => {
    const interval = automation({
      trigger: { type: "interval", every: 1, unit: "hour", timeZone: "UTC" },
    });
    mocks.due.mockResolvedValue([{ id: "automation-1" }]);
    mocks.lock.mockResolvedValue(interval);
    mocks.nextRunAfter.mockReturnValue("2026-11-25T11:00:00.000Z");
    await createScheduler().pass();
    expect(mocks.due).toHaveBeenCalledWith(NOW.toISOString(), 50);
    expect(mocks.nextRunAfter).toHaveBeenCalledWith(
      interval.trigger,
      new Date("2026-11-25T09:00:00.000Z"),
      NOW,
    );
    expect(mocks.schedule).toHaveBeenCalledWith(
      "automation-1",
      "2026-11-25T11:00:00.000Z",
    );
    expect(mocks.enqueue).toHaveBeenCalledWith({
      id: expect.any(String) as string,
      automationId: "automation-1",
      triggerKind: "interval",
      eventType: null,
      triggerSubject: null,
      triggerData: null,
      requestedBy: null,
      queuedAt: NOW.toISOString(),
    });
  });

  it("switches off an automation with a once trigger", async () => {
    const once = automation({
      trigger: {
        type: "once",
        at: "2026-11-25T09:00:00.000Z",
        timeZone: "UTC",
      },
    });
    mocks.due.mockResolvedValue([{ id: "automation-1" }]);
    mocks.lock.mockResolvedValue(once);
    await createScheduler().pass();
    expect(mocks.replace).toHaveBeenCalledWith(
      {
        ...once,
        trigger: { type: "once", at: null, timeZone: "UTC" },
        isActive: false,
        nextRunAt: null,
        revision: 4,
        updatedAt: NOW.toISOString(),
      },
      3,
    );
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("falls back to now when the due time disappears while advancing", async () => {
    let reads = 0;
    const flickering = {
      ...automation({
        trigger: { type: "interval", every: 1, unit: "hour", timeZone: "UTC" },
      }),
      get nextRunAt(): string | null {
        reads += 1;
        return reads <= 2 ? "2026-11-25T09:00:00.000Z" : null;
      },
    };
    mocks.due.mockResolvedValue([{ id: "automation-1" }]);
    mocks.lock.mockResolvedValue(flickering);
    mocks.nextRunAfter.mockReturnValue(null);
    await createScheduler().pass();
    expect(mocks.nextRunAfter).toHaveBeenCalledWith(
      flickering.trigger,
      NOW,
      NOW,
    );
    expect(mocks.schedule).toHaveBeenCalledWith("automation-1", null);
  });

  it.each([
    ["missing", null],
    ["inactive", automation({ isActive: false })],
    ["without a due time", automation({ nextRunAt: null })],
    ["not yet due", automation({ nextRunAt: "2026-11-25T10:00:01.000Z" })],
  ])("skips an automation that is %s", async (label, current) => {
    mocks.due.mockResolvedValue([{ id: "automation-1" }]);
    mocks.lock.mockResolvedValue(current);
    await createScheduler().pass();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("starting and settling runs", () => {
  it("claims and starts startable runs, skipping the executing and unclaimed", async () => {
    const runs = [
      { id: "busy" },
      { id: "lost" },
      { id: "taken" },
      { id: "ok" },
    ];
    mocks.startable.mockResolvedValue(runs);
    executor.isExecuting.mockImplementation((id: string) => id === "busy");
    const conflict = new Error("conflict");
    mocks.claim.mockImplementation((id: string) => {
      if (id === "taken") return Promise.reject(conflict);
      return Promise.resolve(id === "ok");
    });
    await createScheduler().pass();
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    expect(mocks.claim).toHaveBeenCalledWith("ok", NOW.toISOString());
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationScheduler",
      conflict,
    );
    expect(executor.start).toHaveBeenCalledTimes(1);
    expect(executor.start).toHaveBeenCalledWith({
      id: "ok",
      status: "accepted",
    });
  });

  it("logs a failing run", async () => {
    const failure = new Error("run");
    executor.start.mockRejectedValue(failure);
    mocks.startable.mockResolvedValue([{ id: "run-1" }]);
    mocks.claim.mockResolvedValue(true);
    await createScheduler().pass();
    await flush();
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationScheduler",
      failure,
    );
  });

  it("settles open runs that nobody executes", async () => {
    mocks.open.mockResolvedValue([{ id: "running" }, { id: "orphan" }]);
    executor.isExecuting.mockImplementation((id: string) => id === "running");
    await createScheduler().pass();
    expect(executor.settle).toHaveBeenCalledTimes(1);
    expect(executor.settle).toHaveBeenCalledWith({ id: "orphan" });
  });
});

describe("cleaning up", () => {
  it("prunes old deliveries on the first pass only", async () => {
    const scheduler = createScheduler();
    await scheduler.pass();
    await scheduler.pass();
    expect(mocks.pruneEnded).toHaveBeenCalledTimes(1);
    expect(mocks.pruneEnded).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});
