import { describe, expect, it, vi } from "vitest";

import { SettingsService } from "@/backend/service/SettingsService";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";

describe("personal settings", () => {
  it("uses defaults for missing and unsupported stored choices", async () => {
    const findByUserId = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        language: "en",
        dateFormat: "invalid",
        theme: "invalid",
        timezone: "invalid",
        weekStart: "invalid",
        notifyEmail: false,
        notifyDesktop: null,
        notifyMentions: null,
        notifyAssignments: null,
        notifyDueDates: null,
        notifyWeeklySummary: null,
      });
    const service = new SettingsService(
      partial<UserSettingsRepository>({ findByUserId }),
    );
    await expect(service.getUserSettings("u")).resolves.toEqual(
      DEFAULT_USER_SETTINGS,
    );
    await expect(service.getUserSettings("u")).resolves.toEqual({
      ...DEFAULT_USER_SETTINGS,
      language: "en",
      notifications: { ...DEFAULT_USER_SETTINGS.notifications, email: false },
    });
  });

  it("retains valid choices and saves them with notification flags", async () => {
    const findByUserId = vi
      .fn()
      .mockResolvedValue({
        language: "en",
        theme: "dark",
        timezone: "UTC",
        dateFormat: "YYYY-MM-DD",
        weekStart: "sunday",
        notifyEmail: true,
        notifyDesktop: false,
        notifyMentions: true,
        notifyAssignments: false,
        notifyDueDates: true,
        notifyWeeklySummary: false,
        notifyCalendarInvitations: true,
      });
    const upsert = vi.fn().mockResolvedValue(undefined);
    const upsertLanguage = vi.fn().mockResolvedValue(undefined);
    const service = new SettingsService(
      partial<UserSettingsRepository>({ findByUserId, upsert, upsertLanguage }),
    );
    const settings = await service.getUserSettings("u");
    expect(settings).toMatchObject({
      theme: "dark",
      timezone: "UTC",
      dateFormat: "YYYY-MM-DD",
      weekStart: "sunday",
    });
    await service.updateSettings("u", settings);
    expect(upsert).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({
        notifyEmail: true,
        notifyDesktop: false,
        notifyCalendarInvitations: true,
      }),
    );
    await service.updateLanguage("u", "en");
    expect(upsertLanguage).toHaveBeenCalledWith("u", "en");
  });
});
