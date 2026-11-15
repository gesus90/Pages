import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PicaMobileNotificationAccess } from "@/backend/service/mobile/notifications/PicaMobileNotificationAccess";
import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";

import {
  NOW,
  createHarness,
  delivery,
  grantedAccess,
  registration,
  storedEvent,
} from "./pica-mobile-dispatcher-fixture";

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (name: string, work: () => Promise<void>) => {
    void name;
    return work();
  },
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/runtime/ServiceWorkHealth", () => ({
  recordServiceProgress: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

it.each([
  ["run_failed", { planInterruptions: false }, false],
  ["run_succeeded", { planCompletions: false }, false],
  ["step_started", { planAllStatuses: false }, false],
  [
    "step_started",
    { planAllStatuses: true, planInterruptions: false, planCompletions: false },
    true,
  ],
  ["run_failed", { receiveNotifications: false }, false],
] as const)(
  "filters %s using account choices",
  async (eventType, change, shouldSend) => {
    const harness = createHarness();
    harness.deliveries.claimDue.mockResolvedValueOnce([
      delivery({ eventType }),
    ]);
    harness.events.find.mockResolvedValue(storedEvent({ type: eventType }));
    harness.preferences.find.mockResolvedValue({
      accountId: "account-1",
      teamRunsSince: null,
      ...DEFAULT_NOTIFICATION_CHOICES,
      ...change,
    });
    harness.dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await harness.dispatcher.stop();
    expect(harness.sender.send).toHaveBeenCalledTimes(shouldSend ? 1 : 0);
  },
);

it("applies the same event choices to another team member's run", async () => {
  const granted = grantedAccess();
  if (granted.status !== "granted") throw new Error("Expected granted fixture");
  const reader = {
    read: vi.fn(async () => ({ ...granted, relation: "team" as const })),
  };
  const preference = {
    accountId: "member",
    ...DEFAULT_NOTIFICATION_CHOICES,
    teamRuns: true,
    teamRunsSince: "2026-01-01T00:00:00.000Z",
    planCompletions: false,
  };
  const preferences = { find: vi.fn(async () => preference) };
  const access = new PicaMobileNotificationAccess(reader, preferences);
  expect(
    (await access.read("member", "run-1", "2026-03-01T00:00:00.000Z")).status,
  ).toBe("granted");
  const harness = createHarness();
  harness.deliveries.claimDue.mockResolvedValueOnce([
    delivery({ accountId: "member" }),
  ]);
  harness.preferences.find.mockResolvedValue(preference);
  harness.runs.read.mockImplementation((accountId, runId, occurredAt) =>
    access.read(accountId, runId, occurredAt),
  );
  harness.dispatcher.start();
  await vi.advanceTimersByTimeAsync(0);
  await harness.dispatcher.stop();
  expect(harness.sender.send).not.toHaveBeenCalled();

  const interruption = createHarness();
  interruption.deliveries.claimDue.mockResolvedValueOnce([
    delivery({ accountId: "member", eventType: "run_failed" }),
  ]);
  interruption.events.find.mockResolvedValue(
    storedEvent({ type: "run_failed" }),
  );
  interruption.registrations.find.mockResolvedValue(
    registration({ accountId: "member" }),
  );
  interruption.preferences.find.mockResolvedValue(preference);
  interruption.runs.read.mockImplementation((accountId, runId, occurredAt) =>
    access.read(accountId, runId, occurredAt),
  );
  interruption.dispatcher.start();
  await vi.advanceTimersByTimeAsync(0);
  await interruption.dispatcher.stop();
  expect(interruption.sender.send).toHaveBeenCalledOnce();
});
