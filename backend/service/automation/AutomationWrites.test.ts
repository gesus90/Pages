import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";

import { AutomationWrites } from "./AutomationWrites";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationAccount } from "./AutomationDirectory";
import type { AutomationWriteDependencies } from "./AutomationWrites";

const mocks = vi.hoisted(() => ({
  replay: vi.fn(),
  record: vi.fn(),
  repository: {
    insert: vi.fn(),
    lock: vi.fn(),
    delete: vi.fn(),
    replace: vi.fn(),
    find: vi.fn(),
  },
  runs: { blocking: vi.fn(), enqueue: vi.fn(), count: vi.fn() },
  automationView: vi.fn(),
}));

vi.mock("@/backend/service/InterfaceOperationJournal", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  replayInterfaceOperation: mocks.replay,
  recordInterfaceOperation: mocks.record,
}));
vi.mock(
  "@/backend/database/repositories/agents/AgentOperationKeyRepository",
  () => ({ AgentOperationKeyRepository: class {} }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRepository",
  () => ({
    AutomationRepository: class {
      public insert = mocks.repository.insert;
      public lock = mocks.repository.lock;
      public delete = mocks.repository.delete;
      public replace = mocks.repository.replace;
      public find = mocks.repository.find;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationRunRepository",
  () => ({
    AutomationRunRepository: class {
      public blocking = mocks.runs.blocking;
      public enqueue = mocks.runs.enqueue;
      public count = mocks.runs.count;
    },
  }),
);
vi.mock("./AutomationViews", () => ({
  automationView: mocks.automationView,
}));

const NOW = new Date("2026-11-12T10:00:00.000Z");
const PAST = "2026-11-12T09:00:00.000Z";
const FUTURE = "2026-11-13T09:00:00.000Z";
const OPERATION = "0b6c5c6e-5f0e-4c0e-8f6a-0d2f4f7a9c11";
const INTERVAL = {
  type: "interval",
  every: 1,
  unit: "hour",
  timeZone: "UTC",
} as const;
const PLAN_ACTION = { type: "plan", planId: "plan-1" } as const;

const actor: AutomationAccount = {
  id: "u1",
  displayName: "User",
  isAgent: false,
  isActive: true,
  isAdministrator: false,
  isReadOnly: false,
  timeZone: "UTC",
  language: "en",
};
const permissions = {
  canRead: true,
  canEdit: true,
  canRun: true,
  canDelete: true,
};
const stored: StoredAutomation = {
  id: "a1",
  creatorId: "u1",
  name: "Nightly",
  trigger: { type: "manual" },
  action: PLAN_ACTION,
  sharing: { scope: "private" },
  isActive: false,
  deleteAfterSuccess: false,
  agentNotification: { mode: "off" },
  nextRunAt: null,
  revision: 2,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const view = { id: "a1", revision: 3 };
const transaction = { id: "transaction" };

const access = {
  actor: vi.fn(),
  account: vi.fn(),
  checkDefinition: vi.fn(),
  permissions: vi.fn(),
  canSeeScript: vi.fn(),
};
const reads = { requireVisible: vi.fn(), views: vi.fn() };
const database = {
  query: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
};

function writesOf(wake?: () => void): AutomationWrites {
  return new AutomationWrites({
    database,
    access,
    reads,
    now: () => NOW,
    wake,
  } as unknown as AutomationWriteDependencies);
}

function visible(overrides: Partial<StoredAutomation> = {}): void {
  reads.requireVisible.mockResolvedValue({
    automation: { ...stored, ...overrides },
    permissions,
  });
}

function replacedWith(index = 0): StoredAutomation {
  return mocks.repository.replace.mock.calls[index]?.[0] as StoredAutomation;
}

beforeEach(() => {
  vi.resetAllMocks();
  access.actor.mockResolvedValue(actor);
  access.account.mockResolvedValue(actor);
  access.permissions.mockResolvedValue(permissions);
  access.canSeeScript.mockReturnValue(true);
  reads.views.mockResolvedValue([view]);
  database.transaction.mockImplementation(
    async (work: (tx: unknown) => Promise<unknown>) => work(transaction),
  );
  mocks.replay.mockResolvedValue(null);
  mocks.repository.replace.mockResolvedValue(true);
  mocks.automationView.mockReturnValue(view);
  visible();
});

const createInput = {
  operationId: OPERATION,
  name: " Nightly ",
  trigger: { type: "manual" },
  action: PLAN_ACTION,
};

describe("create", () => {
  it("creates an inactive private automation with defaults", async () => {
    await expect(writesOf().create("u1", createInput)).resolves.toBe(view);
    expect(mocks.repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorId: "u1",
        name: "Nightly",
        sharing: { scope: "private" },
        isActive: false,
        nextRunAt: null,
        revision: 1,
      }),
    );
  });

  it("creates an active automation with every field and a fallback view", async () => {
    reads.views.mockResolvedValue([]);
    await writesOf().create("u1", {
      ...createInput,
      trigger: INTERVAL,
      sharing: { scope: "project", projectId: "p1" },
      isActive: true,
      deleteAfterSuccess: true,
      agentNotification: { mode: "error", agentId: "agent" },
    });
    expect(mocks.repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        sharing: { scope: "project", projectId: "p1" },
        isActive: true,
        deleteAfterSuccess: true,
        agentNotification: { mode: "error", agentId: "agent" },
        nextRunAt: "2026-11-12T11:00:00.000Z",
      }),
    );
    expect(mocks.automationView).toHaveBeenCalledWith(
      expect.objectContaining({ creatorId: "u1" }),
      { creator: actor, permissions, canSeeScript: true, lastRun: null },
    );
  });

  it("answers the stored result of a repeated operation", async () => {
    mocks.replay.mockResolvedValue(view);
    await expect(writesOf().create("u1", createInput)).resolves.toEqual({
      ...view,
      replayed: true,
    });
    expect(mocks.repository.insert).not.toHaveBeenCalled();
  });

  it("answers a result committed meanwhile", async () => {
    mocks.replay.mockResolvedValueOnce(null).mockResolvedValueOnce(view);
    await expect(writesOf().create("u1", createInput)).resolves.toEqual({
      ...view,
      replayed: true,
    });
    expect(mocks.repository.insert).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe("create refusals", () => {
  it("refuses a read-only account", async () => {
    access.actor.mockResolvedValue({ ...actor, isReadOnly: true });
    await expect(writesOf().create("u1", createInput)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses a once trigger without a future time", async () => {
    const once = { type: "once", timeZone: "UTC" } as const;
    for (const at of [null, PAST])
      await expect(
        writesOf().create("u1", {
          ...createInput,
          trigger: { ...once, at },
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("accepts a once trigger in the future", async () => {
    await writesOf().create("u1", {
      ...createInput,
      trigger: { type: "once", at: FUTURE, timeZone: "UTC" },
      isActive: true,
    });
    expect(mocks.repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ nextRunAt: FUTURE }),
    );
  });

  it("refuses invalid input", async () => {
    await expect(writesOf().create("u1", {})).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("journal errors", () => {
  it("maps a reused operation ID before the work", async () => {
    mocks.replay.mockRejectedValue(new OperationReusedError());
    await expect(writesOf().create("u1", createInput)).rejects.toMatchObject({
      code: "conflict",
      reason: "operation_reused",
    });
  });

  it("maps a reused operation ID inside the transaction", async () => {
    mocks.replay
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new OperationReusedError());
    await expect(writesOf().create("u1", createInput)).rejects.toMatchObject({
      reason: "operation_reused",
    });
  });

  it("passes other errors on", async () => {
    mocks.replay.mockRejectedValueOnce(new Error("broken"));
    await expect(writesOf().create("u1", createInput)).rejects.toThrow(
      "broken",
    );
    mocks.replay.mockResolvedValueOnce(null);
    mocks.record.mockRejectedValueOnce(new Error("lost"));
    await expect(writesOf().create("u1", createInput)).rejects.toThrow("lost");
  });

  it("checks the shape of stored results", async () => {
    const schemas: { safeParse: (value: unknown) => { success: boolean } }[] =
      [];
    mocks.replay.mockImplementation(async (...parameters) => {
      schemas.push(parameters[2]);
      return null;
    });
    await writesOf().create("u1", createInput);
    mocks.runs.blocking.mockResolvedValue(null);
    mocks.runs.count.mockResolvedValue(0);
    mocks.runs.enqueue.mockResolvedValue({
      run: { id: "r", queuedAt: "t" },
      isCoalesced: false,
    });
    await writesOf().run("u1", runInput);
    mocks.runs.enqueue.mockResolvedValue({
      run: { id: "r", queuedAt: "t" },
      isCoalesced: false,
    });
    mocks.repository.lock.mockResolvedValue({ revision: 2 });
    await writesOf().delete("u1", { ...deleteInput, confirmed: true });
    const [automation, , receipt, , deleted] = schemas;
    const bad = [null, "text", {}];
    expect(automation?.safeParse({ id: "a", revision: 1 }).success).toBe(true);
    for (const value of [...bad, { id: "a" }])
      expect(automation?.safeParse(value).success).toBe(false);
    expect(receipt?.safeParse({ runId: "r" }).success).toBe(true);
    for (const value of bad)
      expect(receipt?.safeParse(value).success).toBe(false);
    expect(deleted?.safeParse({ isDeleted: true }).success).toBe(true);
    for (const value of bad)
      expect(deleted?.safeParse(value).success).toBe(false);
  });
});

const updateInput = {
  operationId: OPERATION,
  automationId: "a1",
  expectedRevision: 2,
};

describe("update", () => {
  it("renames an automation and raises its revision", async () => {
    await expect(
      writesOf().update("u1", { ...updateInput, name: "Renamed" }),
    ).resolves.toBe(view);
    expect(replacedWith()).toEqual({
      ...stored,
      name: "Renamed",
      revision: 3,
      updatedAt: NOW.toISOString(),
    });
    expect(mocks.repository.replace).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("applies every changed field", async () => {
    await writesOf().update("u1", {
      ...updateInput,
      trigger: INTERVAL,
      action: { type: "plan", planId: "plan-2" },
      sharing: { scope: "group", groupId: "g1" },
      isActive: true,
      deleteAfterSuccess: true,
      agentNotification: { mode: "always", agentId: "agent" },
    });
    expect(replacedWith()).toMatchObject({
      trigger: INTERVAL,
      action: { type: "plan", planId: "plan-2" },
      sharing: { scope: "group", groupId: "g1" },
      isActive: true,
      deleteAfterSuccess: true,
      agentNotification: { mode: "always", agentId: "agent" },
      nextRunAt: "2026-11-12T11:00:00.000Z",
    });
    expect(access.checkDefinition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { trigger: true, action: true, sharing: true, agentNotification: true },
    );
  });
});

describe("update refusals", () => {
  it("refuses a once trigger in the past", async () => {
    await expect(
      writesOf().update("u1", {
        ...updateInput,
        trigger: { type: "once", at: PAST, timeZone: "UTC" },
      }),
    ).rejects.toMatchObject({ reason: "time_required" });
  });

  it("keeps the delete flag of a once trigger and clears it otherwise", async () => {
    const once = { type: "once", at: FUTURE, timeZone: "UTC" } as const;
    visible({ trigger: once, deleteAfterSuccess: true });
    await writesOf().update("u1", { ...updateInput, name: "x" });
    expect(replacedWith(0).deleteAfterSuccess).toBe(true);
    visible({ deleteAfterSuccess: true });
    await writesOf().update("u1", { ...updateInput, name: "x" });
    expect(replacedWith(1).deleteAfterSuccess).toBe(false);
  });

  it("answers a repeated operation", async () => {
    mocks.replay.mockResolvedValue(view);
    await expect(
      writesOf().update("u1", { ...updateInput, name: "x" }),
    ).resolves.toEqual({ ...view, replayed: true });
    expect(mocks.repository.replace).not.toHaveBeenCalled();
  });

  it("refuses a read-only account and missing rights", async () => {
    const input = { ...updateInput, name: "x" };
    access.actor.mockResolvedValueOnce({ ...actor, isReadOnly: true });
    await expect(writesOf().update("u1", input)).rejects.toMatchObject({
      reason: "read_only",
    });
    reads.requireVisible.mockResolvedValue({
      automation: stored,
      permissions: { ...permissions, canEdit: false },
    });
    await expect(writesOf().update("u1", input)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses a stale revision", async () => {
    visible({ revision: 7 });
    await expect(
      writesOf().update("u1", { ...updateInput, name: "x" }),
    ).rejects.toMatchObject({
      code: "conflict",
      reason: "revision_conflict",
      currentRevision: 7,
    });
  });

  it("refuses a creator that is gone", async () => {
    access.account.mockResolvedValue(null);
    await expect(
      writesOf().update("u1", { ...updateInput, name: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reports the current revision when the replacement loses", async () => {
    mocks.repository.replace.mockResolvedValue(false);
    mocks.repository.find.mockResolvedValueOnce({ revision: 9 });
    const input = { ...updateInput, name: "x" };
    await expect(writesOf().update("u1", input)).rejects.toMatchObject({
      currentRevision: 9,
    });
    mocks.repository.find.mockResolvedValueOnce(null);
    await expect(writesOf().update("u1", input)).rejects.toMatchObject({
      currentRevision: null,
    });
  });
});

describe("setActive", () => {
  const input = { ...updateInput, isActive: true };

  it("switches an automation on and plans its next run", async () => {
    await writesOf().setActive("u1", input);
    expect(replacedWith()).toMatchObject({ isActive: true, nextRunAt: null });
  });

  it("switches an automation off and drops its next run", async () => {
    visible({ isActive: true, nextRunAt: FUTURE });
    await writesOf().setActive("u1", { ...input, isActive: false });
    expect(replacedWith()).toMatchObject({ isActive: false, nextRunAt: null });
  });

  it("keeps the planned run of an automation that stays on", async () => {
    visible({ isActive: true, nextRunAt: FUTURE });
    await writesOf().setActive("u1", input);
    expect(replacedWith().nextRunAt).toBe(FUTURE);
  });

  it("refuses to switch on a once trigger that has passed", async () => {
    visible({ trigger: { type: "once", at: PAST, timeZone: "UTC" } });
    await expect(writesOf().setActive("u1", input)).rejects.toMatchObject({
      reason: "time_required",
    });
  });

  it("clears the time of a passed once trigger on switching off", async () => {
    const trigger = { type: "once", at: PAST, timeZone: "UTC" } as const;
    visible({ trigger, isActive: true });
    await writesOf().setActive("u1", { ...input, isActive: false });
    expect(replacedWith().trigger).toEqual({ ...trigger, at: null });
  });

  it("keeps the time of a once trigger that has not passed", async () => {
    const future = { type: "once", at: FUTURE, timeZone: "UTC" } as const;
    visible({ trigger: future, isActive: true });
    await writesOf().setActive("u1", { ...input, isActive: false });
    expect(replacedWith(0).trigger).toEqual(future);
    const open = { type: "once", at: null, timeZone: "UTC" } as const;
    visible({ trigger: open, isActive: true });
    await writesOf().setActive("u1", { ...input, isActive: false });
    expect(replacedWith(1).trigger).toEqual(open);
  });
});

const runInput = {
  operationId: OPERATION,
  automationId: "a1",
  expectedRevision: 2,
};

describe("run", () => {
  function enqueued(): void {
    mocks.runs.enqueue.mockResolvedValue({
      run: { id: "run-1", queuedAt: "queued" },
      isCoalesced: true,
    });
  }

  it("accepts a run on an idle automation and wakes the scheduler", async () => {
    enqueued();
    mocks.runs.blocking.mockResolvedValue(null);
    const wake = vi.fn();
    await expect(writesOf(wake).run("u1", runInput)).resolves.toEqual({
      runId: "run-1",
      automationId: "a1",
      status: "accepted",
      isCoalesced: true,
      queuedAt: "queued",
    });
    expect(wake).toHaveBeenCalledOnce();
  });

  it.each([
    ["queued", "accepted"],
    ["running", "queued"],
  ])("answers a run behind a %s one as %s", async (state, status) => {
    enqueued();
    mocks.runs.blocking.mockResolvedValue({ status: state });
    await expect(writesOf().run("u1", runInput)).resolves.toMatchObject({
      status,
    });
  });

  it("answers a repeated operation without a second run", async () => {
    mocks.replay.mockResolvedValue({ runId: "run-1" });
    await expect(writesOf().run("u1", runInput)).resolves.toEqual({
      runId: "run-1",
      replayed: true,
    });
    expect(mocks.runs.enqueue).not.toHaveBeenCalled();
  });

  it("refuses without the right to run and on a stale revision", async () => {
    reads.requireVisible.mockResolvedValue({
      automation: stored,
      permissions: { ...permissions, canRun: false },
    });
    await expect(writesOf().run("u1", runInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    visible({ revision: 5 });
    await expect(writesOf().run("u1", runInput)).rejects.toMatchObject({
      currentRevision: 5,
    });
  });
});

const deleteInput = {
  operationId: OPERATION,
  automationId: "a1",
  expectedRevision: 2,
};

describe("delete", () => {
  it("answers the scope without deleting", async () => {
    mocks.runs.count.mockResolvedValue(4);
    mocks.runs.blocking.mockResolvedValue(null);
    await expect(writesOf().delete("u1", deleteInput)).resolves.toEqual({
      confirmationRequired: true,
      automationId: "a1",
      name: "Nightly",
      expectedRevision: 2,
      runCount: 4,
      blockingRunId: null,
      canDelete: true,
    });
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.repository.delete).not.toHaveBeenCalled();
  });

  it("names the run that blocks a deletion", async () => {
    mocks.runs.count.mockResolvedValue(1);
    mocks.runs.blocking.mockResolvedValue({ id: "run-9", status: "running" });
    await expect(writesOf().delete("u1", deleteInput)).resolves.toMatchObject({
      blockingRunId: "run-9",
      canDelete: false,
    });
  });

  it("deletes after confirmation", async () => {
    mocks.runs.count.mockResolvedValue(3);
    mocks.runs.blocking.mockResolvedValue(null);
    mocks.repository.lock.mockResolvedValue({ revision: 2 });
    await expect(
      writesOf().delete("u1", { ...deleteInput, confirmed: true }),
    ).resolves.toEqual({ automationId: "a1", isDeleted: true, removedRuns: 3 });
    expect(mocks.repository.delete).toHaveBeenCalledWith("a1");
  });

  it("answers a repeated confirmed deletion", async () => {
    mocks.replay.mockResolvedValue({ isDeleted: true });
    await expect(
      writesOf().delete("u1", { ...deleteInput, confirmed: true }),
    ).resolves.toEqual({ isDeleted: true, replayed: true });
    expect(mocks.repository.delete).not.toHaveBeenCalled();
  });

  it("refuses without the right to delete and on a stale revision", async () => {
    reads.requireVisible.mockResolvedValue({
      automation: stored,
      permissions: { ...permissions, canDelete: false },
    });
    await expect(writesOf().delete("u1", deleteInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    visible({ revision: 6 });
    await expect(writesOf().delete("u1", deleteInput)).rejects.toMatchObject({
      currentRevision: 6,
    });
  });

  it("refuses a confirmed deletion while a run blocks", async () => {
    mocks.runs.count.mockResolvedValue(1);
    mocks.runs.blocking.mockResolvedValue({ id: "run-9", status: "running" });
    await expect(
      writesOf().delete("u1", { ...deleteInput, confirmed: true }),
    ).rejects.toMatchObject({ reason: "run_active", currentRevision: 2 });
  });

  it("refuses when the locked automation changed or vanished", async () => {
    mocks.runs.count.mockResolvedValue(0);
    mocks.runs.blocking.mockResolvedValue(null);
    const input = { ...deleteInput, confirmed: true };
    mocks.repository.lock.mockResolvedValueOnce({ revision: 8 });
    await expect(writesOf().delete("u1", input)).rejects.toMatchObject({
      reason: "revision_conflict",
      currentRevision: 8,
    });
    mocks.repository.lock.mockResolvedValueOnce(null);
    await expect(writesOf().delete("u1", input)).rejects.toMatchObject({
      currentRevision: null,
    });
  });

  it("refuses when a run started before the lock", async () => {
    mocks.runs.count.mockResolvedValue(0);
    mocks.runs.blocking
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "run-2", status: "queued" });
    mocks.repository.lock.mockResolvedValue({ revision: 2 });
    await expect(
      writesOf().delete("u1", { ...deleteInput, confirmed: true }),
    ).rejects.toMatchObject({ reason: "run_active", currentRevision: 2 });
    expect(mocks.repository.delete).not.toHaveBeenCalled();
  });
});
