import { expect, it } from "vitest";

import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";

import { scriptedDatabase } from "./scripted-database";

import type { StoredUserSettings } from "@/backend/database/repositories/UserSettingsRepository";

const SETTINGS: StoredUserSettings = {
  language: "de",
  theme: "arctic",
  timezone: "Europe/Berlin",
  dateFormat: "dd.MM.yyyy",
  weekStart: "monday",
  notifyEmail: true,
  notifyDesktop: false,
  notifyMentions: null,
  notifyAssignments: true,
  notifyDueDates: false,
  notifyWeeklySummary: true,
};

it("reads a stored language, null without a row, and refuses an unknown language", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([["en"]], [], [["fr"]]);
  const repository = new UserSettingsRepository(scripted.database);

  await expect(repository.findLanguageByUserId("user-1")).resolves.toBe("en");
  await expect(repository.findLanguageByUserId("user-2")).resolves.toBeNull();
  await expect(repository.findLanguageByUserId("user-3")).rejects.toThrow(
    'unsupported language "fr"',
  );
});

it("upserts the language, design theme and terminal reader mode with bound values", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserSettingsRepository(scripted.database);

  await repository.upsertLanguage("user-1", "de");
  await repository.upsertDesignTheme("user-1", "arctic");
  await repository.upsertTerminalScreenReader("user-1", "on");

  expect(scripted.statements.map((entry) => entry.parameters)).toEqual([
    { user_id: "user-1", language: "de" },
    { user_id: "user-1", design_theme: "arctic" },
    { user_id: "user-1", terminal_screen_reader: "on" },
  ]);
  expect(scripted.ofKind("execute")).toHaveLength(3);
});

it("reads the design theme as stored text, stored null or null without a row", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([["arctic"]], [[null]], []);
  const repository = new UserSettingsRepository(scripted.database);

  await expect(repository.findDesignThemeId("user-1")).resolves.toBe("arctic");
  await expect(repository.findDesignThemeId("user-2")).resolves.toBeNull();
  await expect(repository.findDesignThemeId("user-3")).resolves.toBeNull();
});

it("reads the terminal screen reader mode or null without a row", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([["auto"]], []);
  const repository = new UserSettingsRepository(scripted.database);

  await expect(repository.findTerminalScreenReader("user-1")).resolves.toBe(
    "auto",
  );
  await expect(
    repository.findTerminalScreenReader("user-2"),
  ).resolves.toBeNull();
});

it("maps the complete stored settings of a user", async () => {
  const scripted = scriptedDatabase();
  scripted.answer(
    [
      [
        "de",
        "Europe/Berlin",
        "dd.MM.yyyy",
        "monday",
        1,
        0,
        null,
        1,
        0,
        1,
        "arctic",
      ],
    ],
    [],
    [["xx", null, null, null, null, null, null, null, null, null, null]],
  );
  const repository = new UserSettingsRepository(scripted.database);

  await expect(repository.findByUserId("user-1")).resolves.toEqual(SETTINGS);
  await expect(repository.findByUserId("user-2")).resolves.toBeNull();
  await expect(repository.findByUserId("user-3")).rejects.toThrow(
    'unsupported language "xx"',
  );
});

it("upserts the complete settings and stores missing notification choices as null", async () => {
  const scripted = scriptedDatabase();
  const repository = new UserSettingsRepository(scripted.database);
  const withoutChoices: StoredUserSettings = {
    language: "en",
    theme: null,
    timezone: null,
    dateFormat: null,
    weekStart: null,
    notifyEmail: null,
    notifyDesktop: null,
    notifyMentions: null,
    notifyAssignments: null,
    notifyDueDates: null,
    notifyWeeklySummary: null,
  };

  await repository.upsert("user-1", SETTINGS);
  await repository.upsert("user-2", withoutChoices);

  expect(scripted.statements[0]?.parameters).toEqual({
    user_id: "user-1",
    language: "de",
    timezone: "Europe/Berlin",
    date_format: "dd.MM.yyyy",
    week_start: "monday",
    notify_email: true,
    notify_desktop: false,
    notify_mentions: null,
    notify_assignments: true,
    notify_due_dates: false,
    notify_weekly_summary: true,
    theme: "arctic",
  });
  expect(scripted.statements[1]?.parameters).toMatchObject({
    user_id: "user-2",
    notify_email: null,
    notify_weekly_summary: null,
    theme: null,
  });
});
