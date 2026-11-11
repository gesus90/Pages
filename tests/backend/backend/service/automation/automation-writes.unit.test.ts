import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { AutomationWrites } from "@/backend/service/automation/AutomationWrites";
import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";
import * as journal from "@/backend/service/InterfaceOperationJournal";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationAccess } from "@/backend/service/automation/AutomationAccess";
import type { AutomationReads } from "@/backend/service/automation/AutomationReads";
import type { AutomationAccount } from "@/backend/service/automation/AutomationDirectory";

const NOW = "2030-01-01T00:00:00.000Z";
const OPERATION = "b4f7d506-78d8-42e5-b399-43d1c043e080";
const actor: AutomationAccount = {
  id: "user",
  displayName: "User",
  isAgent: false,
  isActive: true,
  isAdministrator: false,
  isReadOnly: false,
  timeZone: "UTC",
  language: "en",
};
const automation: StoredAutomation = {
  id: "automation",
  creatorId: "user",
  name: "Original",
  trigger: { type: "once", at: "2030-01-02T00:00:00.000Z", timeZone: "UTC" },
  action: { type: "plan", planId: "plan" },
  sharing: { scope: "private" },
  isActive: true,
  deleteAfterSuccess: true,
  agentNotification: { mode: "off" },
  nextRunAt: "2030-01-02T00:00:00.000Z",
  revision: 2,
  createdAt: NOW,
  updatedAt: NOW,
};
const permissions = {
  canRead: true,
  canEdit: true,
  canRun: true,
  canDelete: true,
};
const input = {
  operationId: OPERATION,
  automationId: "automation",
  expectedRevision: 2,
};
const transaction: DatabaseTransaction = { query: vi.fn(), execute: vi.fn() };
const database = partial<Pick<Database, "query" | "execute" | "transaction">>({
  ...transaction,
  transaction: async <Result>(
    work: (tx: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction),
});
const access = partial<AutomationAccess>({});
const reads = partial<AutomationReads>({});

function setup(): AutomationWrites {
  Object.assign(access, {
    actor: vi.fn().mockResolvedValue(actor),
    account: vi.fn().mockResolvedValue(actor),
    checkDefinition: vi.fn().mockResolvedValue(undefined),
    permissions: vi.fn().mockResolvedValue(permissions),
    canSeeScript: vi.fn().mockReturnValue(true),
  });
  Object.assign(reads, {
    requireVisible: vi.fn().mockResolvedValue({ automation, permissions }),
    views: vi.fn().mockResolvedValue([]),
  });
  return new AutomationWrites({
    database,
    access,
    reads,
    now: () => new Date(NOW),
  });
}

beforeEach(() => {
  vi.spyOn(journal, "replayInterfaceOperation").mockResolvedValue(null);
  vi.spyOn(journal, "recordInterfaceOperation").mockResolvedValue(undefined);
  vi.spyOn(AutomationRepository.prototype, "insert").mockResolvedValue(
    undefined,
  );
  vi.spyOn(AutomationRepository.prototype, "replace").mockResolvedValue(true);
  vi.spyOn(AutomationRepository.prototype, "lock").mockResolvedValue(
    automation,
  );
  vi.spyOn(AutomationRepository.prototype, "delete").mockResolvedValue(
    undefined,
  );
  vi.spyOn(AutomationRunRepository.prototype, "count").mockResolvedValue(3);
  vi.spyOn(AutomationRunRepository.prototype, "blocking").mockResolvedValue(
    null,
  );
});
afterEach(() => vi.restoreAllMocks());

it("creates an active automation and records its receipt in the transaction", async () => {
  const writes = setup();
  const result = await writes.create("user", {
    operationId: OPERATION,
    name: "  New  ",
    trigger: automation.trigger,
    action: automation.action,
    isActive: true,
  });
  expect(result).toMatchObject({
    name: "New",
    revision: 1,
    nextRunAt: automation.nextRunAt,
  });
  expect(AutomationRepository.prototype.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "New",
      creatorId: "user",
      isActive: true,
      sharing: { scope: "private" },
    }),
  );
  expect(journal.recordInterfaceOperation).toHaveBeenCalledOnce();
  expect(access.checkDefinition).toHaveBeenCalledOnce();
});

it("rejects a past one-time trigger before writing", async () => {
  const writes = setup();
  await expect(
    writes.create("user", {
      operationId: OPERATION,
      name: "New",
      trigger: { type: "once", at: NOW, timeZone: "UTC" },
      action: automation.action,
    }),
  ).rejects.toMatchObject({ code: "invalid_request", reason: "time_required" });
  expect(AutomationRepository.prototype.insert).not.toHaveBeenCalled();
});

it("patches a definition and preserves its existing schedule", async () => {
  const writes = setup();
  const result = await writes.update("user", { ...input, name: "Renamed" });
  expect(result).toMatchObject({
    name: "Renamed",
    revision: 3,
    nextRunAt: automation.nextRunAt,
  });
  expect(AutomationRepository.prototype.replace).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Renamed", revision: 3 }),
    2,
  );
  expect(access.checkDefinition).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    {
      trigger: false,
      action: false,
      sharing: false,
      agentNotification: false,
    },
  );
});

it("clears an expired once trigger when switching off and refuses switching it on", async () => {
  const writes = setup();
  const expired = {
    ...automation,
    trigger: { type: "once" as const, at: NOW, timeZone: "UTC" },
  };
  vi.mocked(reads.requireVisible).mockResolvedValue({
    automation: expired,
    permissions,
  });
  const result = await writes.setActive("user", { ...input, isActive: false });
  expect(result).toMatchObject({
    isActive: false,
    trigger: { at: null },
    nextRunAt: null,
  });
  vi.mocked(reads.requireVisible).mockResolvedValue({
    automation: { ...expired, isActive: false },
    permissions,
  });
  await expect(
    writes.setActive("user", { ...input, isActive: true }),
  ).rejects.toMatchObject({ reason: "time_required" });
});

it("rejects stale revisions and denies edits without writing", async () => {
  const writes = setup();
  await expect(
    writes.update("user", { ...input, expectedRevision: 1, name: "New" }),
  ).rejects.toMatchObject({ reason: "revision_conflict", currentRevision: 2 });
  vi.mocked(reads.requireVisible).mockResolvedValue({
    automation,
    permissions: { ...permissions, canEdit: false },
  });
  await expect(
    writes.update("user", { ...input, name: "New" }),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(AutomationRepository.prototype.replace).not.toHaveBeenCalled();
});

it("reports deletion scope and deletes only after confirmation", async () => {
  const writes = setup();
  await expect(
    writes.delete("user", input, { requiresWord: false }),
  ).resolves.toEqual({
    confirmationRequired: true,
    automationId: "automation",
    name: "Original",
    expectedRevision: 2,
    runCount: 3,
    blockingRunId: null,
    canDelete: true,
  });
  expect(AutomationRepository.prototype.delete).not.toHaveBeenCalled();
  await expect(
    writes.delete(
      "user",
      { ...input, confirmed: true },
      { requiresWord: false },
    ),
  ).resolves.toEqual({
    automationId: "automation",
    isDeleted: true,
    removedRuns: 3,
  });
  expect(AutomationRepository.prototype.delete).toHaveBeenCalledWith(
    "automation",
  );
});

it("refuses deletion when a run appears inside the transaction", async () => {
  const writes = setup();
  vi.mocked(AutomationRunRepository.prototype.blocking)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(partial({ id: "run", status: "running" }));
  await expect(
    writes.delete(
      "user",
      { ...input, confirmed: true },
      { requiresWord: false },
    ),
  ).rejects.toMatchObject({ reason: "run_active", currentRevision: 2 });
  expect(AutomationRepository.prototype.delete).not.toHaveBeenCalled();
});

it("translates a reused operation into a conflict", async () => {
  const writes = setup();
  vi.mocked(journal.replayInterfaceOperation).mockRejectedValue(
    new OperationReusedError(),
  );
  await expect(writes.run("user", input)).rejects.toMatchObject({
    code: "conflict",
    reason: "operation_reused",
  });
});

it("queues a manual run and wakes the scheduler after the receipt is recorded", async () => {
  setup();
  const wake = vi.fn();
  const writes = new AutomationWrites({
    database,
    access,
    reads,
    now: () => new Date(NOW),
    wake,
  });
  const enqueue = vi
    .spyOn(AutomationRunRepository.prototype, "enqueue")
    .mockResolvedValue({
      run: partial({ id: "queued-run", queuedAt: NOW }),
      isCoalesced: false,
    });
  await expect(writes.run("user", input)).resolves.toEqual({
    runId: "queued-run",
    automationId: "automation",
    status: "accepted",
    isCoalesced: false,
    queuedAt: NOW,
  });
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      automationId: "automation",
      triggerKind: "manual",
      requestedBy: "user",
      queuedAt: NOW,
    }),
  );
  expect(wake).toHaveBeenCalledOnce();
});

it("returns a replayed receipt without queuing or waking", async () => {
  setup();
  const wake = vi.fn();
  const writes = new AutomationWrites({
    database,
    access,
    reads,
    now: () => new Date(NOW),
    wake,
  });
  const receipt = {
    runId: "old-run",
    automationId: "automation",
    status: "accepted",
    isCoalesced: false,
    queuedAt: NOW,
  };
  vi.mocked(journal.replayInterfaceOperation).mockResolvedValue(receipt);
  const enqueue = vi.spyOn(AutomationRunRepository.prototype, "enqueue");
  await expect(writes.run("user", input)).resolves.toEqual({
    ...receipt,
    replayed: true,
  });
  expect(enqueue).not.toHaveBeenCalled();
  expect(wake).not.toHaveBeenCalled();
});
