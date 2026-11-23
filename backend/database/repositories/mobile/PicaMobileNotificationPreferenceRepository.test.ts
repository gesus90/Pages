import { expect, it, vi } from "vitest";

import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";

import { PicaMobileNotificationPreferenceRepository } from "./PicaMobileNotificationPreferenceRepository";

import type { DatabaseValue } from "@/backend/database/Database";

const STORED_ROW: DatabaseValue[] = ["a1", 1, "2026-01-01", 0, 1, 0, 1, 0, 1];

function doubleOf(rows: DatabaseValue[][] = []): {
  repository: PicaMobileNotificationPreferenceRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const executor = { query, execute };

  return {
    repository: new PicaMobileNotificationPreferenceRepository(executor),
    query,
    execute,
  };
}

it("maps a stored row to the choices of the account", async () => {
  const { repository, query } = doubleOf([STORED_ROW]);

  await expect(repository.find("a1")).resolves.toEqual({
    accountId: "a1",
    teamRuns: true,
    teamRunsSince: "2026-01-01",
    receiveNotifications: false,
    chats: true,
    pica: false,
    planInterruptions: true,
    planCompletions: false,
    planAllStatuses: true,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ account_id: "a1" });
});

it("forgets the team run moment while team runs are off", async () => {
  const { repository } = doubleOf([["a1", 0, "2026-01-01", 1, 1, 1, 1, 1, 0]]);

  await expect(repository.find("a1")).resolves.toMatchObject({
    teamRuns: false,
    teamRunsSince: null,
  });
});

it("answers the defaults for an account without a stored choice", async () => {
  const { repository } = doubleOf();

  await expect(repository.find("a2")).resolves.toEqual({
    accountId: "a2",
    ...DEFAULT_NOTIFICATION_CHOICES,
    teamRunsSince: null,
  });
});

it("writes only the supplied choices and reads them back", async () => {
  const { repository, execute } = doubleOf([STORED_ROW]);

  await repository.setChoices("a1", { chats: false }, "now");
  await repository.setChoices(
    "a1",
    {
      receiveNotifications: true,
      chats: true,
      pica: true,
      planInterruptions: true,
      planCompletions: true,
      planAllStatuses: true,
    },
    "now",
  );

  await repository.setChoices("a1", {}, "now");

  expect(execute.mock.calls[2]?.[1]).toMatchObject({ chats: null });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    account_id: "a1",
    now: "now",
    receive_notifications: null,
    chats: false,
    pica: null,
    plan_interruptions: null,
    plan_completions: null,
    plan_all_statuses: null,
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    receive_notifications: true,
    plan_all_statuses: true,
  });
});

it("switches team runs and answers the stored choices", async () => {
  const { repository, execute } = doubleOf([STORED_ROW]);

  await expect(
    repository.setTeamRuns("a1", true, "now"),
  ).resolves.toMatchObject({ accountId: "a1" });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    account_id: "a1",
    team_runs: true,
    now: "now",
  });
});

it("lists the team recipients", async () => {
  const { repository } = doubleOf([STORED_ROW, STORED_ROW]);

  await expect(repository.listTeamRecipients()).resolves.toHaveLength(2);
});
