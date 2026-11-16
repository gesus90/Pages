import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AutomationEventIntakeDependencies } from "@/backend/service/automation/AutomationEventIntake";

const store = vi.hoisted(() => ({
  next: vi.fn(),
  remove: vi.fn(),
  waiting: vi.fn(),
  started: vi.fn(),
  count: vi.fn(),
  enqueue: vi.fn(),
  blocking: vi.fn(),
}));
vi.mock(
  "@/backend/database/repositories/automation/AutomationEventRepository",
  () => ({
    AutomationEventRepository: class {
      public next = store.next;
      public remove = store.remove;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public waitingFor = store.waiting;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public startedPlanRun = store.started;
      public countEventRunsSince = store.count;
      public enqueue = store.enqueue;
      public blocking = store.blocking;
    },
  }),
);

import { AutomationEventIntake } from "@/backend/service/automation/AutomationEventIntake";

const canSeePlan = vi.fn();
const canSeeProject = vi.fn();
const intake = new AutomationEventIntake(
  partial<AutomationEventIntakeDependencies>({
    database: {},
    rules: { canSeePlan, canSeeProject },
    lookups: {
      projectName: async () => "Project",
      statusNames: async () => new Map([["open", "Open"]]),
    },
    now: () => new Date("2026-01-01T12:00:00.000Z"),
  }),
);
const plan = {
  sequence: 1,
  eventType: "plan.run.failed",
  occurredAt: "now",
  actorId: null,
  payload: JSON.stringify({
    event: "ignored",
    at: "now",
    plan: { id: "plan", name: "Plan" },
    run: { id: "run", status: "failed" },
    step: null,
    error: null,
  }),
};
const ticket = {
  sequence: 2,
  eventType: "ticket.created",
  occurredAt: "now",
  actorId: null,
  payload: JSON.stringify({
    ticketId: "t",
    ticketKey: "P-1",
    title: "Ticket",
    projectId: "project",
    statusId: "open",
    previousStatusId: null,
  }),
};
const automation = {
  id: "automation",
  creatorId: "creator",
  trigger: { type: "event", planId: "plan", projectId: "project" },
  action: { type: "agent", agentId: "agent" },
};

beforeEach(() => {
  vi.resetAllMocks();
  store.next.mockResolvedValue([plan]);
  store.waiting.mockResolvedValue([automation]);
  store.started.mockResolvedValue(false);
  store.count.mockResolvedValue(0);
  store.blocking.mockResolvedValue(null);
  canSeePlan.mockResolvedValue(true);
  canSeeProject.mockResolvedValue(true);
});

it("queues matching visible plan events once and advances the inbox", async () => {
  await intake.process();
  expect(store.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      automationId: "automation",
      triggerKind: "event",
      triggerSubject: "Plan",
      eventType: "plan.run.failed",
      queuedAt: "2026-01-01T12:00:00.000Z",
    }),
  );
  expect(store.remove).toHaveBeenCalledWith(1);
  expect(store.count).toHaveBeenCalledWith(
    "automation",
    "2026-01-01T11:00:00.000Z",
  );
});

it("ignores its own plan runs, inaccessible plans and excess events", async () => {
  store.started.mockResolvedValueOnce(true).mockResolvedValue(false);
  await intake.process();
  canSeePlan.mockResolvedValueOnce(false);
  await intake.process();
  store.count.mockResolvedValueOnce(60);
  await intake.process();
  expect(store.enqueue).not.toHaveBeenCalled();
});

it("queues visible matching ticket events and ignores the agent's own running work", async () => {
  store.next.mockResolvedValue([ticket]);
  await intake.process();
  expect(store.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      triggerSubject: "P-1",
      eventType: "ticket.created",
    }),
  );
  store.enqueue.mockClear();
  store.next.mockResolvedValue([{ ...ticket, actorId: "agent" }]);
  store.blocking.mockResolvedValue({ status: "running" });
  await intake.process();
  expect(store.enqueue).not.toHaveBeenCalled();
});

it("advances past malformed events and leaves an empty inbox alone", async () => {
  store.next
    .mockResolvedValueOnce([{ ...plan, payload: "invalid" }])
    .mockResolvedValueOnce([]);
  await intake.process();
  expect(store.remove).toHaveBeenCalledWith(1);
  store.remove.mockClear();
  await intake.process();
  expect(store.remove).not.toHaveBeenCalled();
});
