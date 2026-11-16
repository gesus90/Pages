import { afterEach, expect, it, vi } from "vitest";

import { AutomationAgentJobRepository } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import { AutomationNotificationPreferenceRepository } from "@/backend/database/repositories/automation/AutomationNotificationPreferenceRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { AutomationRunEnding } from "@/backend/service/automation/AutomationRunEnding";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationRunEndingDependencies } from "@/backend/service/automation/AutomationRunEnding";

const AUTOMATION = partial<StoredAutomation>({
  id: "automation",
  creatorId: "owner",
  name: "Reminder",
  isActive: true,
  revision: 1,
  deleteAfterSuccess: false,
  action: { type: "plan", planId: "plan" },
  agentNotification: { mode: "off" },
});
const RUN = partial<StoredAutomationRun>({
  id: "run",
  automationId: "automation",
  triggerKind: "manual",
  eventType: null,
});

function fixture(): {
  ending: AutomationRunEnding;
  notifyPerson: ReturnType<typeof vi.fn>;
} {
  const notifyPerson = vi.fn(async () => undefined);
  const transaction = partial<DatabaseTransaction>({});
  const dependencies = partial<AutomationRunEndingDependencies>({
    database: {
      transaction: async (
        work: (value: DatabaseTransaction) => Promise<unknown>,
      ) => work(transaction),
    },
    rules: {
      account: async () => ({
        id: "owner",
        isActive: true,
        isAgent: false,
        language: "en",
      }),
      canUseAgent: async () => true,
    },
    now: () => new Date("2030-01-01T00:00:00Z"),
    notifyPerson,
  });
  return { ending: new AutomationRunEnding(dependencies), notifyPerson };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("stores a successful result once, notifies the creator and prunes old runs", async () => {
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    AUTOMATION,
  );
  const finish = vi
    .spyOn(AutomationRunRepository.prototype, "finish")
    .mockResolvedValue(true);
  const prune = vi
    .spyOn(AutomationRunRepository.prototype, "prune")
    .mockResolvedValue(undefined);
  vi.spyOn(
    AutomationNotificationPreferenceRepository.prototype,
    "find",
  ).mockResolvedValue("always");
  const { ending, notifyPerson } = fixture();
  await ending.end(RUN, { outcome: "ok", summary: "Done" });
  expect(finish).toHaveBeenCalledWith(
    "run",
    expect.objectContaining({
      status: "completed",
      paused: false,
      endedAt: "2030-01-01T00:00:00.000Z",
    }),
  );
  expect(notifyPerson).toHaveBeenCalledWith(
    "owner",
    expect.objectContaining({ runId: "run", outcome: "ok" }),
  );
  expect(prune).toHaveBeenCalledWith("automation", 50);
});

it("does no follow-up when another worker already ended the run", async () => {
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    AUTOMATION,
  );
  vi.spyOn(AutomationRunRepository.prototype, "finish").mockResolvedValue(
    false,
  );
  const prune = vi.spyOn(AutomationRunRepository.prototype, "prune");
  const { ending, notifyPerson } = fixture();
  await ending.end(RUN, { outcome: "failed" });
  expect(notifyPerson).not.toHaveBeenCalled();
  expect(prune).not.toHaveBeenCalled();
});

it("pauses an active automation when the run loses permission", async () => {
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    AUTOMATION,
  );
  vi.spyOn(AutomationRepository.prototype, "lock").mockResolvedValue(
    AUTOMATION,
  );
  const replace = vi
    .spyOn(AutomationRepository.prototype, "replace")
    .mockResolvedValue(true);
  const finish = vi
    .spyOn(AutomationRunRepository.prototype, "finish")
    .mockResolvedValue(true);
  vi.spyOn(
    AutomationNotificationPreferenceRepository.prototype,
    "find",
  ).mockResolvedValue("off");
  await fixture().ending.end(RUN, { outcome: "forbidden" });
  expect(finish).toHaveBeenCalledWith(
    "run",
    expect.objectContaining({ status: "failed", paused: true }),
  );
  expect(replace).toHaveBeenCalledWith(
    expect.objectContaining({ isActive: false, revision: 2, nextRunAt: null }),
    1,
  );
});

it("queues an agent notification once and deletes a successful one-time automation", async () => {
  const automation = {
    ...AUTOMATION,
    deleteAfterSuccess: true,
    agentNotification: { mode: "always" as const, agentId: "agent" },
  };
  vi.spyOn(AutomationRepository.prototype, "find").mockResolvedValue(
    automation,
  );
  const remove = vi
    .spyOn(AutomationRepository.prototype, "delete")
    .mockResolvedValue(undefined);
  vi.spyOn(AutomationRunRepository.prototype, "finish").mockResolvedValue(true);
  const enqueue = vi
    .spyOn(AutomationAgentJobRepository.prototype, "enqueue")
    .mockResolvedValue(true);
  vi.spyOn(
    AutomationNotificationPreferenceRepository.prototype,
    "find",
  ).mockResolvedValue("off");
  await fixture().ending.end(
    { ...RUN, triggerKind: "once" },
    { outcome: "ok", answer: "Done" },
  );
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "run",
      agentId: "agent",
      kind: "notification",
    }),
  );
  expect(remove).toHaveBeenCalledWith("automation");
});
