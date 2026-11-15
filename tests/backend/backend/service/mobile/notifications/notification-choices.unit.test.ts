import { expect, it, vi } from "vitest";

import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";
import { PicaMobileNotificationPreferenceRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository";
import { PicaMobileConversationPresence } from "@/backend/service/mobile/conversations/PicaMobileConversationPresence";
import { parsePicaMobileNotificationPayload } from "@/backend/service/mobile/notifications/PicaMobileNotificationMessages";
import { PicaMobileNotificationService } from "@/backend/service/mobile/notifications/PicaMobileNotificationService";
import {
  wantsChatMessage,
  wantsPlanEvent,
} from "@/backend/service/mobile/notifications/NotificationChoicePolicy";
import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { PicaMobileNotificationParts } from "@/backend/service/mobile/notifications/PicaMobileNotificationService";

it("keeps defaults for accounts without a preference row and migrates existing rows", async () => {
  const database = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
  };
  const repository = new PicaMobileNotificationPreferenceRepository(database);
  expect(await repository.find("owner")).toMatchObject(
    DEFAULT_NOTIFICATION_CHOICES,
  );
  const migration = POSTGRES_MIGRATIONS.find(
    (entry) => entry.name === "062_notification_choices.sql",
  );
  expect(migration?.sql).toContain(
    "plan_all_statuses BOOLEAN NOT NULL DEFAULT FALSE",
  );
  expect(migration?.sql).toContain(
    "receive_notifications BOOLEAN NOT NULL DEFAULT TRUE",
  );
});

it("writes the supplied choices beside team runs without changing absent fields", async () => {
  const database = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
  };
  const repository = new PicaMobileNotificationPreferenceRepository(database);
  await repository.setChoices(
    "owner",
    { chats: false, planAllStatuses: true },
    "2026-11-15T13:00:00.000Z",
  );
  expect(database.execute).toHaveBeenCalledWith(
    expect.stringContaining("plan_all_statuses = COALESCE"),
    expect.objectContaining({
      account_id: "owner",
      chats: false,
      plan_all_statuses: true,
      plan_interruptions: null,
    }),
  );
});

it("treats all statuses as a superset and the main choice as limited to chats, Pica and plans", () => {
  const defaults = DEFAULT_NOTIFICATION_CHOICES;
  expect(wantsPlanEvent(defaults, "step_started")).toBe(false);
  expect(wantsPlanEvent(defaults, "run_failed")).toBe(true);
  expect(wantsPlanEvent(defaults, "run_cancelled")).toBe(true);
  expect(wantsPlanEvent(defaults, "run_succeeded")).toBe(true);
  expect(
    wantsPlanEvent(
      {
        ...defaults,
        planAllStatuses: true,
        planInterruptions: false,
        planCompletions: false,
      },
      "step_started",
    ),
  ).toBe(true);
  expect(
    wantsPlanEvent({ ...defaults, receiveNotifications: false }, "run_failed"),
  ).toBe(false);
  expect(
    wantsChatMessage({ ...defaults, receiveNotifications: false }, false),
  ).toBe(false);
  expect(wantsChatMessage({ ...defaults, chats: false }, false)).toBe(false);
  expect(wantsChatMessage({ ...defaults, pica: false }, true)).toBe(false);
});

it("combines browser heartbeats and app presence, expiring browsers after 45 seconds", () => {
  let now = 100_000;
  const presence = new PicaMobileConversationPresence(() => now);
  presence.setBrowser("owner", "tab", "group:chat", "chat");
  expect(presence.isOpen("owner", "chat")).toBe(true);
  now += 44_999;
  expect(presence.isOpen("owner", "chat")).toBe(true);
  now += 1;
  expect(presence.isOpen("owner", "chat")).toBe(false);
  presence.set("owner", "app", "chat");
  expect(presence.isOpen("owner", "chat")).toBe(true);
  presence.set("owner", "app", null);
  expect(presence.isOpen("owner", "chat")).toBe(false);
});

it("keeps older app messages that only change team runs valid", () => {
  expect(
    parsePicaMobileNotificationPayload(
      "notification_settings_set",
      "request-1",
      { teamRuns: true },
    ),
  ).toMatchObject({
    ok: true,
    message: { payload: { teamRuns: true } },
  });
  expect(
    parsePicaMobileNotificationPayload(
      "notification_settings_set",
      "request-1",
      { chats: false, planAllStatuses: true },
    ),
  ).toMatchObject({
    ok: true,
    message: { payload: { chats: false, planAllStatuses: true } },
  });
});

it("returns the optional main choice and lets an older app change only team runs", async () => {
  const preference = {
    accountId: "owner",
    ...DEFAULT_NOTIFICATION_CHOICES,
    teamRunsSince: null,
  };
  const changed = {
    ...preference,
    teamRuns: true,
    teamRunsSince: "2026-11-15T13:00:00.000Z",
  };
  const preferences = {
    find: vi.fn(async () => preference),
    setTeamRuns: vi.fn(async () => changed),
    setChoices: vi.fn(async () => changed),
  };
  const service = new PicaMobileNotificationService(
    partial<PicaMobileNotificationParts>({
      preferences,
      isPushAvailable: true,
      now: () => new Date("2026-11-15T13:00:00.000Z"),
    }),
  );
  expect(await service.readSettings("owner")).toMatchObject({
    receiveNotifications: true,
    planAllStatuses: false,
  });
  const result = await service.changeSettings("owner", { teamRuns: true });
  expect(result.kind).toBe("ready");
  expect(preferences.setChoices).toHaveBeenCalledWith(
    "owner",
    { teamRuns: true },
    "2026-11-15T13:00:00.000Z",
  );
  expect(result).toMatchObject({
    payload: { teamRuns: { isEnabled: true }, receiveNotifications: true },
  });
});
