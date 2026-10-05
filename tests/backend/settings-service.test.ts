import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsService } from "@/backend/service/SettingsService";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";

import type {
  StoredUserSettings,
  UserSettingsRepository,
} from "@/backend/database/repositories/UserSettingsRepository";

type RepositoryDouble = UserSettingsRepository & {
  findByUserId: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  upsertLanguage: ReturnType<typeof vi.fn>;
};

function createRepository(): RepositoryDouble {
  return {
    findByUserId: vi.fn(),
    upsert: vi.fn(),
    upsertLanguage: vi.fn(),
  } as unknown as RepositoryDouble;
}

function createStoredSettings(
  overrides: Partial<StoredUserSettings> = {},
): StoredUserSettings {
  return {
    dateFormat: null,
    language: LANGUAGE.GERMAN,
    notifyAssignments: null,
    notifyDesktop: null,
    notifyDueDates: null,
    notifyEmail: null,
    notifyMentions: null,
    notifyWeeklySummary: null,
    timezone: null,
    weekStart: null,
    ...overrides,
  };
}

describe("SettingsService", () => {
  let repository: RepositoryDouble;
  let service: SettingsService;

  beforeEach(() => {
    repository = createRepository();
    service = new SettingsService(repository);
  });

  it("returns the stored language for a user", async () => {
    repository.findByUserId.mockResolvedValue(
      createStoredSettings({ language: LANGUAGE.ENGLISH }),
    );

    await expect(service.getUserSettings("user-1")).resolves.toEqual({
      ...DEFAULT_USER_SETTINGS,
      language: LANGUAGE.ENGLISH,
    });
    expect(repository.findByUserId).toHaveBeenCalledWith("user-1");
  });

  it("falls back to German and the defaults without stored settings", async () => {
    repository.findByUserId.mockResolvedValue(null);

    await expect(service.getUserSettings("user-1")).resolves.toEqual(
      DEFAULT_USER_SETTINGS,
    );
    expect(DEFAULT_USER_SETTINGS.language).toBe(LANGUAGE.GERMAN);
  });

  it("returns stored display preferences and notification choices", async () => {
    repository.findByUserId.mockResolvedValue(
      createStoredSettings({
        dateFormat: "YYYY-MM-DD",
        notifyAssignments: false,
        notifyWeeklySummary: true,
        timezone: "Europe/Berlin",
        weekStart: "sunday",
      }),
    );

    const settings = await service.getUserSettings("user-1");

    expect(settings).toMatchObject({
      dateFormat: "YYYY-MM-DD",
      timezone: "Europe/Berlin",
      weekStart: "sunday",
    });
    expect(settings.notifications).toEqual({
      ...DEFAULT_USER_SETTINGS.notifications,
      assignments: false,
      weeklySummary: true,
    });
  });

  it("ignores stored values that are no longer supported", async () => {
    repository.findByUserId.mockResolvedValue(
      createStoredSettings({
        dateFormat: "DD-MM-YY",
        timezone: "Mars/Olympus",
        weekStart: "friday",
      }),
    );

    await expect(service.getUserSettings("user-1")).resolves.toMatchObject({
      dateFormat: DEFAULT_USER_SETTINGS.dateFormat,
      timezone: DEFAULT_USER_SETTINGS.timezone,
      weekStart: DEFAULT_USER_SETTINGS.weekStart,
    });
  });

  it("propagates lookup failures", async () => {
    repository.findByUserId.mockRejectedValue(
      new Error("Database unavailable"),
    );

    await expect(service.getUserSettings("user-1")).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("persists the complete settings of a user", async () => {
    repository.upsert.mockResolvedValue(undefined);

    await service.updateSettings("user-1", {
      dateFormat: "MM/DD/YYYY",
      language: LANGUAGE.ENGLISH,
      notifications: {
        assignments: false,
        desktop: true,
        dueDates: false,
        email: true,
        mentions: false,
        weeklySummary: true,
      },
      timezone: "Europe/London",
      weekStart: "sunday",
    });

    expect(repository.upsert).toHaveBeenCalledWith("user-1", {
      dateFormat: "MM/DD/YYYY",
      language: LANGUAGE.ENGLISH,
      notifyAssignments: false,
      notifyDesktop: true,
      notifyDueDates: false,
      notifyEmail: true,
      notifyMentions: false,
      notifyWeeklySummary: true,
      timezone: "Europe/London",
      weekStart: "sunday",
    });
  });

  it("persists language changes", async () => {
    repository.upsertLanguage.mockResolvedValue(undefined);

    await service.updateLanguage("user-1", LANGUAGE.ENGLISH);

    expect(repository.upsertLanguage).toHaveBeenCalledWith(
      "user-1",
      LANGUAGE.ENGLISH,
    );
  });

  it("propagates persistence failures", async () => {
    repository.upsertLanguage.mockRejectedValue(new Error("Write failed"));

    await expect(
      service.updateLanguage("user-1", LANGUAGE.GERMAN),
    ).rejects.toThrow("Write failed");
  });
});
