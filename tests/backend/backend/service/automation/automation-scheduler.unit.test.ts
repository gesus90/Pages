import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AutomationSchedulerDependencies } from "@/backend/service/automation/AutomationScheduler";

const store = vi.hoisted(() => ({
  due: vi.fn(),
  lock: vi.fn(),
  replace: vi.fn(),
  schedule: vi.fn(),
  enqueue: vi.fn(),
  startable: vi.fn(),
  claim: vi.fn(),
  open: vi.fn(),
  prune: vi.fn(),
}));
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public due = store.due;
      public lock = store.lock;
      public replace = store.replace;
      public schedule = store.schedule;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public enqueue = store.enqueue;
      public startable = store.startable;
      public claim = store.claim;
      public open = store.open;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: class {
      public pruneEnded = store.prune;
    },
  }),
);

import { AutomationScheduler } from "@/backend/service/automation/AutomationScheduler";

const processEvents = vi.fn();
const isExecuting = vi.fn();
const start = vi.fn();
const settle = vi.fn();
const abortAll = vi.fn();
const scheduler = new AutomationScheduler(
  partial<AutomationSchedulerDependencies>({
    database: {
      transaction: async (work: (transaction: object) => Promise<unknown>) =>
        work({}),
    },
    intake: { process: processEvents },
    executor: { isExecuting, start, settle, abortAll },
    now: () => new Date("2026-01-01T12:00:00.000Z"),
  }),
);
const once = {
  id: "automation",
  isActive: true,
  nextRunAt: "2026-01-01T11:00:00.000Z",
  revision: 3,
  trigger: { type: "once", at: "2026-01-01T11:00:00.000Z" },
};

beforeEach(() => {
  vi.resetAllMocks();
  store.due.mockResolvedValue([]);
  store.lock.mockResolvedValue(once);
  store.startable.mockResolvedValue([]);
  store.open.mockResolvedValue([]);
  store.claim.mockResolvedValue(true);
  isExecuting.mockReturnValue(false);
  start.mockResolvedValue(undefined);
});

it("advances a due one-time automation before enqueuing its run", async () => {
  store.due.mockResolvedValue([{ id: "automation" }]);
  await scheduler.pass();
  expect(store.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      isActive: false,
      nextRunAt: null,
      revision: 4,
      trigger: { type: "once", at: null },
    }),
    3,
  );
  expect(store.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      automationId: "automation",
      triggerKind: "once",
      queuedAt: "2026-01-01T12:00:00.000Z",
    }),
  );
  expect(store.replace.mock.invocationCallOrder[0]).toBeLessThan(
    store.enqueue.mock.invocationCallOrder[0],
  );
});

it("ignores inactive or no longer due work", async () => {
  store.due.mockResolvedValue([{ id: "automation" }]);
  store.lock
    .mockResolvedValueOnce({ ...once, isActive: false })
    .mockResolvedValueOnce({ ...once, nextRunAt: "2026-01-02T00:00:00.000Z" });
  await scheduler.pass();
  await scheduler.pass();
  expect(store.enqueue).not.toHaveBeenCalled();
});

it("claims waiting runs and settles only work not already executing", async () => {
  store.startable.mockResolvedValue([{ id: "new" }, { id: "busy" }]);
  store.open.mockResolvedValue([{ id: "old" }, { id: "busy" }]);
  isExecuting.mockImplementation((id: string) => id === "busy");
  await scheduler.pass();
  expect(store.claim).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledWith({ id: "new", status: "accepted" });
  expect(settle).toHaveBeenCalledWith({ id: "old" });
});

it("continues later scheduler stages when event intake fails", async () => {
  processEvents.mockRejectedValueOnce(new Error("failure"));
  await scheduler.pass();
  expect(store.due).toHaveBeenCalledOnce();
  expect(store.open).toHaveBeenCalledOnce();
  await scheduler.stop();
  expect(abortAll).toHaveBeenCalledOnce();
});
