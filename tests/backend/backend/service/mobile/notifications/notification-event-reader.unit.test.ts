import { expect, it, vi } from "vitest";

import { PicaMobileNotificationEventReader } from "@/backend/service/mobile/notifications/PicaMobileNotificationEventReader";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { StoredNotificationEvent } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import type { AgentPlanOwnerRunAccess } from "@/backend/service/agents/AgentPlanOwnerRunReader";

const EVENT: StoredNotificationEvent = {
  eventId: "event",
  accountId: "account",
  planId: "plan",
  runId: "run",
  seq: 1,
  type: "step_started",
  occurredAt: "2026-01-01T00:00:00Z",
  reason: null,
  stepCount: 3,
  steps: [
    {
      instanceId: "bad id",
      stepId: "step",
      loopId: null,
      number: 2,
      attempt: 0,
      iteration: null,
    },
  ],
};
const ACCESS = partial<Extract<AgentPlanOwnerRunAccess, { status: "granted" }>>(
  {
    status: "granted",
    relation: "team",
    plan: { id: "plan", name: " Current plan " },
    run: {
      status: "work_done_closeout_open",
      steps: [{ id: "step", name: " Current step " }],
    },
  },
);

it("does not disclose missing or another account's event", async () => {
  const find = vi.fn(async () => EVENT);
  const read = vi.fn(async () => ACCESS);
  const reader = new PicaMobileNotificationEventReader({ find }, { read });
  await expect(reader.read("other", "event")).resolves.toEqual({
    eventId: "event",
    access: "gone",
  });
  expect(read).not.toHaveBeenCalled();
  const missing = new PicaMobileNotificationEventReader(
    { find: async () => null },
    { read },
  );
  await expect(missing.read("account", "event")).resolves.toEqual({
    eventId: "event",
    access: "gone",
  });
});

it("rechecks access and exposes only current names and state", async () => {
  const read = vi.fn(async () => ACCESS);
  const reader = new PicaMobileNotificationEventReader(
    { find: async () => EVENT },
    { read },
  );
  const result = await reader.read("account", "event");
  expect(read).toHaveBeenCalledWith("account", "run", EVENT.occurredAt);
  expect(result).toMatchObject({
    access: "ok",
    event: {
      scope: "team",
      plan: { name: "Current plan" },
      run: { status: "failed" },
      stepCount: 3,
      steps: [
        {
          name: "Current step",
          attempt: 1,
        },
      ],
    },
  });
  if (result.access !== "ok") throw new Error("Expected event access");
  expect(result.event.steps?.[0]?.instanceId).toMatch(/^si-[a-f0-9]{32}$/u);
});

it("returns only the identifier when rights disappear or no step remains", async () => {
  for (const [status, expected] of [
    ["gone", "gone"],
    ["denied", "forbidden"],
  ] as const) {
    const reader = new PicaMobileNotificationEventReader(
      { find: async () => EVENT },
      { read: async () => ({ status }) },
    );
    await expect(reader.read("account", "event")).resolves.toEqual({
      eventId: "event",
      access: expected,
    });
  }
  const reader = new PicaMobileNotificationEventReader(
    { find: async () => ({ ...EVENT, steps: [] }) },
    { read: async () => ACCESS },
  );
  await expect(reader.read("account", "event")).resolves.toEqual({
    eventId: "event",
    access: "gone",
  });
});

it("limits failure reasons without splitting a surrogate pair", async () => {
  const reader = new PicaMobileNotificationEventReader(
    {
      find: async () => ({
        ...EVENT,
        type: "run_failed",
        reason: `${"a".repeat(199)}😀`,
      }),
    },
    { read: async () => ACCESS },
  );
  await expect(reader.read("account", "event")).resolves.toMatchObject({
    access: "ok",
    event: { reason: "a".repeat(199) },
  });
});
