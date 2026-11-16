import { expect, it, vi } from "vitest";

import { PicaMobileNotificationRecorder } from "@/backend/service/mobile/notifications/PicaMobileNotificationRecorder";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { PicaMobileNotificationRecorderOptions } from "@/backend/service/mobile/notifications/PicaMobileNotificationRecorder";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const BEFORE = partial<AgentPlanRun>({
  id: "run",
  userId: "owner",
  planId: "plan",
  status: "running",
  steps: [{ id: "step", status: "waiting" }],
});
const AFTER = partial<AgentPlanRun>({
  ...BEFORE,
  steps: [{ id: "step", status: "running" }],
});

it("bundles committed starts and notifies only authorized registered recipients", async () => {
  const record = vi.fn(async () => "event");
  const onRecorded = vi.fn();
  const read = vi.fn(async (account: string) =>
    account === "denied"
      ? { status: "denied" }
      : {
          status: "granted",
          flow: { numberOf: () => 2, isStep: () => true, isEntry: () => false },
        },
  );
  const recorder = new PicaMobileNotificationRecorder(
    partial<PicaMobileNotificationRecorderOptions>({
      registrations: {
        listActivated: async (account: string) => [
          {
            deviceId: `${account}-device`,
            registeredAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
      preferences: {
        listTeamRecipients: async () => [
          { accountId: "team" },
          { accountId: "owner" },
          { accountId: "denied" },
        ],
      },
      events: { record },
      runs: { read },
      replayTtlSeconds: 60,
      onRecorded,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  recorder.runChanged(BEFORE, AFTER);
  await recorder.stop();
  expect(record).toHaveBeenCalledTimes(2);
  expect(onRecorded).toHaveBeenCalledTimes(2);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: "owner",
      type: "step_started",
      deviceIds: ["owner-device"],
      expiresAt: "2026-01-01T00:01:00.000Z",
      candidates: [
        {
          key: "step:step",
          steps: [
            {
              instanceId: "step",
              stepId: "step",
              loopId: null,
              number: 2,
              attempt: 1,
              iteration: null,
            },
          ],
        },
      ],
    }),
    "2026-01-01T00:00:00.000Z",
  );
  recorder.runChanged(BEFORE, AFTER);
  expect(record).toHaveBeenCalledTimes(2);
});

it("does not announce initial steps or a run interrupted by Pages", async () => {
  const record = vi.fn();
  const recorder = new PicaMobileNotificationRecorder(
    partial<PicaMobileNotificationRecorderOptions>({
      registrations: {
        listActivated: async () => [
          { deviceId: "device", registeredAt: "2025-01-01T00:00:00.000Z" },
        ],
      },
      preferences: { listTeamRecipients: async () => [] },
      events: { record },
      runs: {
        read: async () => ({
          status: "granted",
          flow: { numberOf: () => 1, isStep: () => true, isEntry: () => true },
        }),
      },
      replayTtlSeconds: 60,
      onRecorded: () => {},
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  recorder.runChanged(BEFORE, AFTER);
  recorder.runChanged(
    AFTER,
    partial<AgentPlanRun>({
      ...AFTER,
      status: "failed",
      controlError: "plan_interrupted",
    }),
  );
  await recorder.stop();
  expect(record).not.toHaveBeenCalled();
});
