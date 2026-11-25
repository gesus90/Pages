import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationEventIntake } from "./AutomationEventIntake";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomationEvent } from "@/backend/database/repositories/automation/AutomationEventRepository";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/definition/Automation";
import type { AutomationAccess } from "./AutomationAccess";

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  remove: vi.fn(),
  waitingFor: vi.fn(),
  startedPlanRun: vi.fn(),
  countEventRunsSince: vi.fn(),
  blocking: vi.fn(),
  enqueue: vi.fn(),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock(
  "@/backend/database/repositories/automation/AutomationEventRepository",
  () => ({
    AutomationEventRepository: class {
      public next = mocks.next;
      public remove = mocks.remove;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public waitingFor = mocks.waitingFor;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public startedPlanRun = mocks.startedPlanRun;
      public countEventRunsSince = mocks.countEventRunsSince;
      public blocking = mocks.blocking;
      public enqueue = mocks.enqueue;
    },
  }),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: mocks.logEvent,
}));

const NOW = new Date("2026-11-25T12:00:00.000Z");

const rules = {
  canSeePlan: vi.fn(),
  canSeeProject: vi.fn(),
};
const lookups = {
  projectName: vi.fn(),
  statusNames: vi.fn(),
};

function intake(): AutomationEventIntake {
  return new AutomationEventIntake({
    database: {} as unknown as Database,
    rules: rules as unknown as AutomationAccess,
    lookups,
    now: () => NOW,
  });
}

function stored(
  eventType: StoredAutomationEvent["eventType"],
  payload: unknown,
  actorId: string | null = null,
  sequence = 1,
): StoredAutomationEvent {
  return {
    sequence,
    eventType,
    payload: JSON.stringify(payload),
    actorId,
    occurredAt: "2026-11-25T11:00:00.000Z",
  };
}

function automation(
  trigger: AutomationTrigger,
  action: AutomationAction = { type: "plan", planId: "p" },
): StoredAutomation {
  return {
    id: "a1",
    creatorId: "u1",
    trigger,
    action,
  } as unknown as StoredAutomation;
}

const PLAN_PAYLOAD = {
  event: "ignored",
  at: "2026-11-25T10:00:00.000Z",
  plan: { id: "plan1", name: "Plan One" },
  run: { id: "run1", status: "running" },
  step: { id: "step1", name: "Step", status: "running" },
  error: null,
};

const TICKET_PAYLOAD = {
  ticketId: "t1",
  ticketKey: "PG-1",
  title: "Title",
  projectId: "proj1",
  statusId: "s2",
  previousStatusId: "s1",
};

function enqueued(): Record<string, unknown> {
  const call = mocks.enqueue.mock.calls[0] as [Record<string, unknown>];
  return call[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.next.mockResolvedValue([]);
  mocks.waitingFor.mockResolvedValue([]);
  mocks.startedPlanRun.mockResolvedValue(false);
  mocks.countEventRunsSince.mockResolvedValue(0);
  mocks.blocking.mockResolvedValue(null);
  rules.canSeePlan.mockResolvedValue(true);
  rules.canSeeProject.mockResolvedValue(true);
  lookups.projectName.mockResolvedValue("Project");
  lookups.statusNames.mockResolvedValue(
    new Map([
      ["s1", "Open"],
      ["s2", "Done"],
    ]),
  );
});

describe("process", () => {
  it("does nothing without events", async () => {
    await intake().process();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("queues a storage event and removes the batch", async () => {
    const usage = { totalBytes: 2, limitBytes: 1, largestDirectoryBytes: [1] };
    mocks.next.mockResolvedValue([
      stored("storage.limit_exceeded", usage, null, 4),
      stored("storage.limit_exceeded", usage, null, 5),
    ]);
    mocks.waitingFor.mockResolvedValue([
      automation({ type: "event", eventType: "storage.limit_exceeded" }),
    ]);
    await intake().process();
    expect(mocks.waitingFor).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(enqueued()).toMatchObject({
      automationId: "a1",
      triggerKind: "event",
      eventType: "storage.limit_exceeded",
      triggerSubject: null,
      triggerData: JSON.stringify(usage),
      requestedBy: null,
      queuedAt: NOW.toISOString(),
    });
    expect(mocks.remove).toHaveBeenCalledWith(5);
  });

  it("skips events with an invalid payload", async () => {
    mocks.next.mockResolvedValue([
      stored("storage.limit_exceeded", { nope: 1 }),
      stored("plan.started", { nope: 1 }),
      stored("ticket.created", { nope: 1 }),
    ]);
    await intake().process();
    expect(mocks.waitingFor).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith(1);
  });

  it("logs a failing event and continues", async () => {
    mocks.next.mockResolvedValue([stored("plan.started", PLAN_PAYLOAD)]);
    mocks.waitingFor.mockRejectedValue(new Error("down"));
    await intake().process();
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationEventIntake",
      expect.any(Error),
    );
    expect(mocks.remove).toHaveBeenCalledWith(1);
  });
});

describe("plan events", () => {
  async function offerPlan(trigger: AutomationTrigger): Promise<void> {
    mocks.next.mockResolvedValue([stored("plan.started", PLAN_PAYLOAD)]);
    mocks.waitingFor.mockResolvedValue([automation(trigger)]);
    await intake().process();
  }

  it("queues a matching event with the plan name as subject", async () => {
    await offerPlan({
      type: "event",
      eventType: "plan.started",
      planId: "plan1",
      stepId: "step1",
    });
    expect(enqueued()).toMatchObject({ triggerSubject: "Plan One" });
    expect(JSON.parse(enqueued().triggerData as string)).toMatchObject({
      event: "plan.started",
    });
  });

  it("ignores other triggers than event triggers", async () => {
    await offerPlan({ type: "manual" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("filters by plan", async () => {
    await offerPlan({ type: "event", eventType: "plan.started", planId: "x" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("filters by step", async () => {
    await offerPlan({ type: "event", eventType: "plan.started", stepId: "x" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("ignores runs the automation started itself", async () => {
    mocks.startedPlanRun.mockResolvedValue(true);
    await offerPlan({ type: "event", eventType: "plan.started" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("requires that the creator sees the plan", async () => {
    rules.canSeePlan.mockResolvedValue(false);
    await offerPlan({ type: "event", eventType: "plan.started" });
    expect(rules.canSeePlan).toHaveBeenCalledWith("plan1", "u1");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("treats a failing visibility check as refused", async () => {
    rules.canSeePlan.mockRejectedValue(new Error("down"));
    await offerPlan({ type: "event", eventType: "plan.started" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("drops events beyond the hourly limit", async () => {
    mocks.countEventRunsSince.mockResolvedValue(60);
    await offerPlan({ type: "event", eventType: "plan.started" });
    expect(mocks.countEventRunsSince).toHaveBeenCalledWith(
      "a1",
      "2026-11-25T11:00:00.000Z",
    );
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "automation.event.limited" }),
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("matches a step-less event only without a step filter", async () => {
    mocks.next.mockResolvedValue([
      stored("plan.succeeded", { ...PLAN_PAYLOAD, step: null }),
    ]);
    mocks.waitingFor.mockResolvedValue([
      automation({ type: "event", eventType: "plan.succeeded", stepId: "s" }),
    ]);
    await intake().process();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

async function offerTicket(
  trigger: AutomationTrigger,
  options: {
    readonly action?: AutomationAction;
    readonly actorId?: string | null;
    readonly payload?: unknown;
  } = {},
): Promise<void> {
  mocks.next.mockResolvedValue([
    stored(
      "ticket.status_changed",
      options.payload ?? TICKET_PAYLOAD,
      options.actorId ?? null,
    ),
  ]);
  mocks.waitingFor.mockResolvedValue([automation(trigger, options.action)]);
  await intake().process();
}

const TRIGGER: AutomationTrigger = {
  type: "event",
  eventType: "ticket.status_changed",
  projectId: "proj1",
};

describe("ticket events", () => {
  it("queues a ticket event with names and the ticket key", async () => {
    await offerTicket({ ...TRIGGER, statusId: "s2" });
    expect(enqueued()).toMatchObject({ triggerSubject: "PG-1" });
    expect(JSON.parse(enqueued().triggerData as string)).toEqual({
      event: "ticket.status_changed",
      at: "2026-11-25T11:00:00.000Z",
      ticket: { id: "t1", key: "PG-1", title: "Title" },
      project: { id: "proj1", name: "Project" },
      status: { id: "s2", name: "Done" },
      previousStatus: { id: "s1", name: "Open" },
    });
  });

  it("handles missing names and a missing previous status", async () => {
    mocks.next.mockResolvedValue([
      stored("ticket.created", {
        ...TICKET_PAYLOAD,
        statusId: "zz",
        previousStatusId: null,
      }),
    ]);
    mocks.waitingFor.mockResolvedValue([automation(TRIGGER)]);
    await intake().process();
    expect(JSON.parse(enqueued().triggerData as string)).toMatchObject({
      status: { id: "zz", name: null },
      previousStatus: null,
    });
  });

  it("names an unknown previous status with null", async () => {
    await offerTicket(TRIGGER, {
      payload: { ...TICKET_PAYLOAD, previousStatusId: "gone" },
    });
    expect(JSON.parse(enqueued().triggerData as string)).toMatchObject({
      previousStatus: { id: "gone", name: null },
    });
  });

  it("filters by project and status", async () => {
    await offerTicket({ ...TRIGGER, projectId: "other" });
    await offerTicket({ ...TRIGGER, statusId: "s9" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe("ticket event filters", () => {
  it("requires that the creator sees the project", async () => {
    rules.canSeeProject.mockResolvedValue(false);
    await offerTicket(TRIGGER);
    expect(rules.canSeeProject).toHaveBeenCalledWith("proj1", "u1");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("ignores tickets of the own agent while a run is active", async () => {
    mocks.blocking.mockResolvedValue({ status: "accepted" });
    await offerTicket(TRIGGER, {
      action: { type: "agent", agentId: "ag", instruction: "x" },
      actorId: "ag",
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("ignores tickets of the forward agent of a script", async () => {
    mocks.blocking.mockResolvedValue({ status: "delivered" });
    await offerTicket(TRIGGER, {
      action: {
        type: "script",
        workspaceId: "w",
        interpreterProfileId: "i",
        content: null,
        timeoutSeconds: 1,
        forward: { agentId: "ag", when: "always" },
      },
      actorId: "ag",
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("accepts the ticket of the own agent while a run only waits", async () => {
    mocks.blocking.mockResolvedValue({ status: "queued" });
    await offerTicket(TRIGGER, {
      action: { type: "agent", agentId: "ag", instruction: "x" },
      actorId: "ag",
    });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("accepts the ticket of the own agent without a run", async () => {
    await offerTicket(TRIGGER, {
      action: { type: "agent", agentId: "ag", instruction: "x" },
      actorId: "ag",
    });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("accepts tickets of other actors and of scripts without forward", async () => {
    await offerTicket(TRIGGER, {
      action: {
        type: "script",
        workspaceId: "w",
        interpreterProfileId: "i",
        content: null,
        timeoutSeconds: 1,
      },
      actorId: "someone",
    });
    expect(mocks.blocking).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
});
