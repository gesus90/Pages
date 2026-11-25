import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutomationRunEnding } from "./AutomationRunEnding";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationAccess } from "./AutomationAccess";
import type { AutomationAccount } from "./AutomationDirectory";
import type { AutomationRunEndingDependencies } from "./AutomationRunEnding";

const state = vi.hoisted(() => ({
  automation: null as object | null,
  locked: null as object | null,
  isEnded: true,
  mode: "always",
  find: vi.fn(),
  lock: vi.fn(),
  replace: vi.fn(),
  remove: vi.fn(),
  finish: vi.fn(),
  prune: vi.fn(),
  enqueue: vi.fn(),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: state.logCaughtError,
  logEvent: state.logEvent,
}));
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public replace = state.replace;
      public delete = state.remove;
      public find = async (id: string): Promise<object | null> => {
        state.find(id);
        return state.automation;
      };
      public lock = async (id: string): Promise<object | null> => {
        state.lock(id);
        return state.locked;
      };
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public prune = state.prune;
      public finish = async (id: string, ending: object): Promise<boolean> => {
        state.finish(id, ending);
        return state.isEnded;
      };
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationAgentJobRepository",
  () => ({
    AutomationAgentJobRepository: class {
      public enqueue = state.enqueue;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationNotificationPreferenceRepository",
  () => ({
    AutomationNotificationPreferenceRepository: class {
      public find = async (): Promise<string> => state.mode;
    },
  }),
);

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const NOW = new Date("2026-11-25T10:00:00.000Z");

const creator: AutomationAccount = {
  id: "u1",
  displayName: "User",
  isAgent: false,
  isActive: true,
  isAdministrator: false,
  isReadOnly: false,
  timeZone: "UTC",
  language: "en",
};

function automationOf(overrides: object = {}): StoredAutomation {
  return doubleOf<StoredAutomation>({
    id: "a1",
    creatorId: "u1",
    name: "Nightly",
    action: { type: "plan", planId: "p1" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off", agentId: null },
    revision: 3,
    ...overrides,
  });
}

function runOf(overrides: object = {}): StoredAutomationRun {
  return doubleOf<StoredAutomationRun>({
    id: "r1",
    automationId: "a1",
    triggerKind: "schedule",
    eventType: null,
    ...overrides,
  });
}

interface Fixture {
  readonly ending: AutomationRunEnding;
  readonly account: ReturnType<typeof vi.fn>;
  readonly canUseAgent: ReturnType<typeof vi.fn>;
  readonly notifyPerson: ReturnType<typeof vi.fn>;
}

function fixture(account: AutomationAccount | null = creator): Fixture {
  const accountMock = vi.fn(async () => account);
  const canUseAgent = vi.fn(async () => true);
  const notifyPerson = vi.fn(async () => undefined);
  const database = {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(async (work: (transaction: object) => Promise<void>) =>
      work({}),
    ),
  };
  const dependencies = doubleOf<AutomationRunEndingDependencies>({
    database,
    rules: doubleOf<AutomationAccess>({
      account: accountMock,
      canUseAgent,
    }),
    now: () => NOW,
    notifyPerson,
  });
  return {
    ending: new AutomationRunEnding(dependencies),
    account: accountMock,
    canUseAgent,
    notifyPerson,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.automation = automationOf();
  state.locked = null;
  state.isEnded = true;
  state.mode = "always";
});

describe("end", () => {
  it("stores the result and prunes the runs", async () => {
    const { ending, notifyPerson } = fixture();
    await ending.end(runOf(), { outcome: "ok" });
    expect(state.finish).toHaveBeenCalledWith("r1", {
      outcome: "ok",
      status: "completed",
      paused: false,
      endedAt: NOW.toISOString(),
    });
    expect(state.logEvent).toHaveBeenCalledTimes(1);
    expect(state.prune).toHaveBeenCalledWith("a1", 50);
    expect(notifyPerson).toHaveBeenCalledWith("u1", {
      automationId: "a1",
      automationName: "Nightly",
      runId: "r1",
      outcome: "ok",
      endedAt: NOW.toISOString(),
    });
  });

  it("does nothing more when the run had already ended", async () => {
    state.isEnded = false;
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.logEvent).not.toHaveBeenCalled();
  });

  it("does nothing more when the automation is gone", async () => {
    state.automation = null;
    await fixture().ending.end(runOf(), { outcome: "failed" });
    expect(state.finish).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ status: "failed", paused: false }),
    );
    expect(state.prune).not.toHaveBeenCalled();
  });

  it("marks a forbidden once run as failed and paused", async () => {
    state.locked = automationOf();
    await fixture().ending.end(runOf({ triggerKind: "once" }), {
      outcome: "forbidden",
    });
    expect(state.finish).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ status: "failed", paused: true }),
    );
  });

  it("pauses the automation on missing rights", async () => {
    state.locked = automationOf();
    await fixture().ending.end(runOf(), { outcome: "forbidden" });
    expect(state.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        nextRunAt: null,
        revision: 4,
        updatedAt: NOW.toISOString(),
      }),
      3,
    );
    expect(state.prune).not.toHaveBeenCalled();
  });

  it("keeps an already paused automation untouched", async () => {
    state.automation = automationOf({ isActive: false });
    state.locked = automationOf({ isActive: false });
    await fixture().ending.end(runOf(), { outcome: "forbidden" });
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.prune).toHaveBeenCalled();
  });

  it("does not replace when the lock finds nothing", async () => {
    await fixture().ending.end(runOf(), { outcome: "forbidden" });
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("deletes a once automation after success when asked", async () => {
    state.automation = automationOf({ deleteAfterSuccess: true });
    await fixture().ending.end(runOf({ triggerKind: "once" }), {
      outcome: "ok",
    });
    expect(state.remove).toHaveBeenCalledWith("a1");
    expect(state.prune).not.toHaveBeenCalled();
  });
});

describe("end of once runs", () => {
  it("keeps a once automation after failure", async () => {
    state.automation = automationOf({ deleteAfterSuccess: true });
    await fixture().ending.end(runOf({ triggerKind: "once" }), {
      outcome: "failed",
    });
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.prune).toHaveBeenCalled();
  });

  it("keeps a once automation that does not ask for deletion", async () => {
    await fixture().ending.end(runOf({ triggerKind: "once" }), {
      outcome: "ok",
    });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("keeps a recurring automation after success", async () => {
    state.automation = automationOf({ deleteAfterSuccess: true });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("logs errors of the follow-up and continues", async () => {
    state.automation = automationOf({
      agentNotification: { mode: "always", agentId: "g1" },
    });
    const { ending, account } = fixture();
    account.mockRejectedValue(new Error("down"));
    await ending.end(runOf(), { outcome: "ok" });
    expect(state.logCaughtError).toHaveBeenCalledTimes(2);
    expect(state.prune).toHaveBeenCalled();
  });
});

describe("agent notification", () => {
  function notifying(mode: string, action?: object): void {
    state.automation = automationOf({
      agentNotification: { mode, agentId: "g1" },
      ...(action ? { action } : {}),
    });
  }

  it("enqueues a notification with the result", async () => {
    notifying("always");
    await fixture().ending.end(runOf({ eventType: "ticket.created" }), {
      outcome: "failed",
      exitCode: 2,
      answer: "answer",
      error: "boom",
    });
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r1",
        agentId: "g1",
        kind: "notification",
        queuedAt: NOW.toISOString(),
      }),
    );
  });

  it("falls back to the trigger, the summary and the error code", async () => {
    notifying("always");
    await fixture().ending.end(runOf(), {
      outcome: "failed",
      summary: "sum",
      errorCode: "code",
    });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).toHaveBeenCalledTimes(2);
  });

  it("stays silent for mode off or without an agent", async () => {
    notifying("off");
    await fixture().ending.end(runOf(), { outcome: "ok" });
    state.automation = automationOf({
      agentNotification: { mode: "always", agentId: null },
    });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("notifies on errors only in mode error", async () => {
    notifying("error");
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).not.toHaveBeenCalled();
    await fixture().ending.end(runOf(), { outcome: "forbidden" });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("agent notification of other agents", () => {
  function notifying(mode: string, action: object): void {
    state.automation = automationOf({
      agentNotification: { mode, agentId: "g1" },
      action,
    });
  }

  it("skips an agent that ran the automation", async () => {
    notifying("always", { type: "agent", agentId: "g1" });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("notifies another agent than the acting one", async () => {
    notifying("always", { type: "agent", agentId: "g2" });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });

  it("skips an agent that was woken by the script", async () => {
    notifying("always", {
      type: "script",
      forward: { agentId: "g1", when: "always" },
    });
    await fixture().ending.end(runOf(), {
      outcome: "ok",
      forwardState: "woken",
    });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("notifies a forward agent that was not woken", async () => {
    notifying("always", {
      type: "script",
      forward: { agentId: "g1", when: "always" },
    });
    await fixture().ending.end(runOf(), {
      outcome: "ok",
      forwardState: "not_woken",
    });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });

  it("notifies when the script forwards to someone else or nobody", async () => {
    notifying("always", {
      type: "script",
      forward: { agentId: "g2", when: "always" },
    });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    notifying("always", { type: "script" });
    await fixture().ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).toHaveBeenCalledTimes(2);
  });

  it("skips a missing creator or an agent they cannot use", async () => {
    notifying("always", { type: "plan", planId: "p1" });
    await fixture(null).ending.end(runOf(), { outcome: "ok" });
    const denied = fixture();
    denied.canUseAgent.mockResolvedValue(false);
    await denied.ending.end(runOf(), { outcome: "ok" });
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});

describe("creator notification", () => {
  it("skips missing, inactive and agent creators", async () => {
    await fixture(null).ending.end(runOf(), { outcome: "ok" });
    await fixture({ ...creator, isActive: false }).ending.end(runOf(), {
      outcome: "ok",
    });
    const agent = fixture({ ...creator, isAgent: true });
    await agent.ending.end(runOf(), { outcome: "ok" });
    expect(agent.notifyPerson).not.toHaveBeenCalled();
  });

  it("respects the chosen mode", async () => {
    state.mode = "off";
    const off = fixture();
    await off.ending.end(runOf(), { outcome: "failed" });
    expect(off.notifyPerson).not.toHaveBeenCalled();
    state.mode = "error";
    const error = fixture();
    await error.ending.end(runOf(), { outcome: "ok" });
    expect(error.notifyPerson).not.toHaveBeenCalled();
    await error.ending.end(runOf(), { outcome: "failed" });
    expect(error.notifyPerson).toHaveBeenCalledTimes(1);
  });
});
