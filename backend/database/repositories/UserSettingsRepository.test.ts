import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { UserSettingsRepository } from "./UserSettingsRepository";

import type { StoredUserSettings } from "./UserSettingsRepository";
import type { Database } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: UserSettingsRepository;
}

function repositoryOf(rows: unknown[][] = []): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => rows);
  return {
    execute,
    query,
    repository: new UserSettingsRepository({
      execute,
      query,
    } as unknown as Pick<Database, "query" | "execute">),
  };
}

it("finds the language", async () => {
  await expect(
    repositoryOf([["de"]]).repository.findLanguageByUserId("u"),
  ).resolves.toBe("de");
  await expect(
    repositoryOf().repository.findLanguageByUserId("u"),
  ).resolves.toBeNull();
});

it("rejects an unsupported language", async () => {
  await expect(
    repositoryOf([["xx"]]).repository.findLanguageByUserId("u"),
  ).rejects.toThrow('unsupported language "xx"');
  await expect(
    repositoryOf([["xx"]]).repository.findByUserId("u"),
  ).rejects.toThrow('unsupported language "xx"');
});

it("upserts language and design theme", async () => {
  const { repository, execute } = repositoryOf();
  await repository.upsertLanguage("u", "de");
  await repository.upsertDesignTheme("u", "dark");
  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    user_id: "u",
    language: "de",
  });
  expect(execute).toHaveBeenNthCalledWith(2, expect.any(String), {
    user_id: "u",
    design_theme: "dark",
  });
});

it("finds the design theme", async () => {
  await expect(
    repositoryOf([["dark"]]).repository.findDesignThemeId("u"),
  ).resolves.toBe("dark");
  await expect(
    repositoryOf([[null]]).repository.findDesignThemeId("u"),
  ).resolves.toBeNull();
  await expect(
    repositoryOf().repository.findDesignThemeId("u"),
  ).resolves.toBeNull();
});

it("reads the complete settings row", async () => {
  const row = ["de", "UTC", "iso", "mon", 1, 0, null, 1, 0, 1, "t", 0];
  await expect(
    repositoryOf([row]).repository.findByUserId("u"),
  ).resolves.toEqual({
    language: "de",
    theme: "t",
    timezone: "UTC",
    dateFormat: "iso",
    weekStart: "mon",
    notifyEmail: true,
    notifyDesktop: false,
    notifyMentions: null,
    notifyAssignments: true,
    notifyDueDates: false,
    notifyWeeklySummary: true,
    notifyCalendarInvitations: false,
  });
  await expect(repositoryOf().repository.findByUserId("u")).resolves.toBeNull();
});

it("replaces the complete settings row", async () => {
  const { repository, execute } = repositoryOf();
  const full: StoredUserSettings = {
    language: "de",
    theme: "t",
    timezone: "UTC",
    dateFormat: "iso",
    weekStart: "mon",
    notifyEmail: true,
    notifyDesktop: false,
    notifyMentions: true,
    notifyAssignments: false,
    notifyDueDates: true,
    notifyWeeklySummary: false,
    notifyCalendarInvitations: true,
  };
  await repository.upsert("u", full);
  await repository.upsert("u", {
    language: "de",
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
  });
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({
      notify_email: true,
      notify_calendar_invitations: true,
    }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    expect.objectContaining({
      notify_email: null,
      notify_calendar_invitations: null,
    }),
  );
});
