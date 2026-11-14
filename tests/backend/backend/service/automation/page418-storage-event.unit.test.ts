import { beforeEach, expect, it, vi } from "vitest";

import { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import { AutomationRepository } from "@/backend/database/repositories/automation/AutomationRepository";
import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";
import { PagesEventOutboxReaderRepository } from "@/backend/database/repositories/events/PagesEventOutboxReaderRepository";
import { AutomationEventIntake } from "@/backend/service/automation/AutomationEventIntake";
import { AUTOMATION_EVENT_EXAMPLES } from "@/backend/service/automation/AutomationEventData";
import { AUTOMATION_EVENT_TYPES } from "@/definition/Automation";
import { pagesCoreLiveRequestSchema } from "@/definition/PagesCoreContract";
import { automationTriggerSchema } from "@/definition/AutomationSchema";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { AutomationAccess } from "@/backend/service/automation/AutomationAccess";

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

const NOW = "2026-11-14T12:00:00.000Z";
const USAGE = {
  totalBytes: 25_000_000_000,
  limitBytes: 20_000_000_000,
  largestDirectoryBytes: [18_000_000_000, 5_000_000_000],
};
const automation: StoredAutomation = {
  id: "automation",
  creatorId: "user",
  name: "Storage warning",
  trigger: { type: "event", eventType: "storage.limit_exceeded" },
  action: { type: "agent", agentId: "agent", instruction: "Report the usage" },
  sharing: { scope: "private" },
  isActive: true,
  deleteAfterSuccess: false,
  agentNotification: { mode: "off" },
  nextRunAt: null,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => {
  vi.spyOn(AutomationEventRepository.prototype, "next").mockResolvedValue([
    {
      sequence: 1,
      eventType: "storage.limit_exceeded",
      payload: JSON.stringify(USAGE),
      actorId: null,
      occurredAt: NOW,
    },
  ]);
  vi.spyOn(AutomationEventRepository.prototype, "remove").mockResolvedValue(
    undefined,
  );
  vi.spyOn(AutomationRepository.prototype, "waitingFor").mockResolvedValue([
    automation,
  ]);
  vi.spyOn(
    AutomationRunRepository.prototype,
    "countEventRunsSince",
  ).mockResolvedValue(0);
  vi.spyOn(AutomationRunRepository.prototype, "enqueue").mockResolvedValue(
    partial({ isCoalesced: false }),
  );
});

function intake(): {
  service: AutomationEventIntake;
  project: ReturnType<typeof vi.fn>;
} {
  const project = vi.fn();
  return {
    project,
    service: new AutomationEventIntake({
      database: partial<Pick<Database, "query" | "execute" | "transaction">>(
        {},
      ),
      rules: partial<AutomationAccess>({
        canSeeProject: project,
        canSeePlan: vi.fn(),
      }),
      lookups: { projectName: vi.fn(), statusNames: vi.fn() },
      now: () => new Date(NOW),
    }),
  };
}

it("offers the new event and size example and accepts a trigger without object filters", () => {
  expect(AUTOMATION_EVENT_TYPES).toContain("storage.limit_exceeded");
  expect(AUTOMATION_EVENT_EXAMPLES["storage.limit_exceeded"]).toEqual(USAGE);
  expect(automationTriggerSchema.parse(automation.trigger)).toEqual(
    automation.trigger,
  );
  for (const filter of ["planId", "stepId", "projectId", "statusId"])
    expect(
      automationTriggerSchema.safeParse({
        ...automation.trigger,
        [filter]: "reference",
      }).success,
    ).toBe(false);
});

it("turns a durable storage warning into an automation run with numeric payload, without project lookups", async () => {
  const { service, project } = intake();
  await service.process();
  expect(AutomationRepository.prototype.waitingFor).toHaveBeenCalledWith(
    "storage.limit_exceeded",
  );
  expect(AutomationRunRepository.prototype.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      automationId: "automation",
      eventType: "storage.limit_exceeded",
      triggerKind: "event",
      triggerSubject: null,
      triggerData: JSON.stringify(USAGE),
    }),
  );
  expect(project).not.toHaveBeenCalled();
  expect(AutomationEventRepository.prototype.remove).toHaveBeenCalledWith(1);
});

it("rejects storage payloads with content or invalid sizes", async () => {
  for (const payload of [
    { ...USAGE, content: "private" },
    { ...USAGE, totalBytes: -1 },
    { ...USAGE, largestDirectoryBytes: [1, 2, 3, 4, 5, 6] },
  ]) {
    vi.mocked(AutomationEventRepository.prototype.next).mockResolvedValue([
      {
        sequence: 1,
        eventType: "storage.limit_exceeded",
        payload: JSON.stringify(payload),
        actorId: null,
        occurredAt: NOW,
      },
    ]);
    await intake().service.process();
  }
  expect(AutomationRunRepository.prototype.enqueue).not.toHaveBeenCalled();
});

it("retains the existing hourly automation event limit", async () => {
  vi.mocked(
    AutomationRunRepository.prototype.countEventRunsSince,
  ).mockResolvedValue(60);
  await intake().service.process();
  expect(AutomationRunRepository.prototype.enqueue).not.toHaveBeenCalled();
});

it("reads numeric usage from the durable Pages event outbox", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([[0]])
    .mockResolvedValueOnce([
      [
        1,
        "storage.limit_exceeded",
        "storage",
        null,
        "[]",
        NOW,
        JSON.stringify(USAGE),
      ],
    ]);
  const database = partial<Database>({
    readTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
      work({ query, execute: vi.fn() }),
  });
  const batch = await new PagesEventOutboxReaderRepository(database).readAfter(
    0,
    10,
  );
  expect(batch.events).toEqual([
    {
      position: 1,
      type: "storage.limit_exceeded",
      id: "storage",
      audience: null,
      createdAt: NOW,
      storage: USAGE,
    },
  ]);
});

it("keeps pages-core live batches valid when the new event is among ordinary changes", () => {
  expect(
    pagesCoreLiveRequestSchema.safeParse({
      contract: 1,
      sessions: [],
      events: [
        {
          position: 1,
          kind: "storage.limit_exceeded",
          id: "storage",
          audience: null,
        },
        { position: 2, kind: "ticket.updated", id: "ticket", audience: null },
      ],
    }).success,
  ).toBe(true);
});
