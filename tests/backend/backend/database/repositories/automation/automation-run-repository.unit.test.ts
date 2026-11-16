import { expect, it, vi } from "vitest";

import { AutomationRunRepository } from "@/backend/database/repositories/automation/AutomationRunRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

const ROW = [
  "run",
  3n,
  "automation",
  "manual",
  null,
  null,
  null,
  null,
  "queued",
  null,
  null,
  null,
  null,
  null,
  0,
  null,
  null,
  null,
  null,
  null,
  "2026-01-01",
  null,
  null,
];
const REQUEST = {
  id: "run",
  automationId: "automation",
  triggerKind: "manual" as const,
  eventType: null,
  triggerSubject: null,
  triggerData: null,
  requestedBy: null,
  queuedAt: "2026-01-01",
};

it("returns an inserted run or coalesces into the already waiting one", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([ROW])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([ROW])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  const repository = new AutomationRunRepository(partial<Database>({ query }));
  await expect(repository.enqueue(REQUEST)).resolves.toMatchObject({
    isCoalesced: false,
    run: { id: "run", sequence: 3, status: "queued" },
  });
  await expect(repository.enqueue(REQUEST)).resolves.toMatchObject({
    isCoalesced: true,
    run: { id: "run" },
  });
  await expect(repository.enqueue(REQUEST)).rejects.toThrow(
    "The waiting run vanished.",
  );
});

it("normalizes unknown stored enum values and optional counters", async () => {
  const row = [...ROW];
  row[1] = null;
  row[3] = "unknown";
  row[4] = "unknown";
  row[8] = "unknown";
  row[9] = "unknown";
  row[10] = 5n;
  row[11] = "unknown";
  const query = vi.fn(async () => [row]);
  const repository = new AutomationRunRepository(partial<Database>({ query }));
  await expect(repository.findById("run")).resolves.toMatchObject({
    sequence: 0,
    triggerKind: "manual",
    eventType: null,
    status: "failed",
    outcome: null,
    exitCode: 5,
    forwardState: null,
  });
});

it("avoids querying empty lists and returns claim and count results", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[1]])
    .mockResolvedValueOnce([[7n]]);
  const repository = new AutomationRunRepository(partial<Database>({ query }));
  await expect(
    repository.list({ automationIds: [], beforeSequence: null, limit: 5 }),
  ).resolves.toEqual([]);
  await expect(repository.latest([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
  await expect(repository.claim("run", "now")).resolves.toBe(false);
  await expect(repository.startedPlanRun("automation", "plan")).resolves.toBe(
    true,
  );
  await expect(repository.count("automation")).resolves.toBe(7);
});
