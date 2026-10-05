import {
  DEFAULT_USER_SETTINGS,
  isUserDateFormat,
  isUserTimezone,
  isUserWeekStart,
} from "@/definition/Settings";

import type {
  StoredUserSettings,
  UserSettingsRepository,
} from "@/backend/database/repositories/UserSettingsRepository";
import type { UserSettings } from "@/definition/Settings";
import type { Language } from "@/language/Language";

/**
 * Keeps a stored value only when it is still a supported choice.
 *
 * @param value - The stored value; empty values count as missing.
 * @param isValid - Tells whether the value is a supported choice.
 * @param fallback - What to use when the value is missing or unsupported.
 */
function pickValid<Value extends string, Fallback>(
  value: string | null | undefined,
  isValid: (candidate: unknown) => candidate is Value,
  fallback: Fallback,
): Value | Fallback {
  return value && isValid(value) ? value : fallback;
}

/** Fills the stored notification choices up with the defaults. */
function toNotifications(
  stored: StoredUserSettings | null,
): UserSettings["notifications"] {
  const defaults = DEFAULT_USER_SETTINGS.notifications;

  return {
    assignments: stored?.notifyAssignments ?? defaults.assignments,
    desktop: stored?.notifyDesktop ?? defaults.desktop,
    dueDates: stored?.notifyDueDates ?? defaults.dueDates,
    email: stored?.notifyEmail ?? defaults.email,
    mentions: stored?.notifyMentions ?? defaults.mentions,
    weeklySummary: stored?.notifyWeeklySummary ?? defaults.weeklySummary,
  };
}

/**
 * Establishes the business-logic boundary for personal user settings.
 *
 * @remarks
 * Kept separate from any future server-wide settings, which will require
 * administrator authorization instead of the "own data" access every user
 * has here.
 */
export class SettingsService {
  private readonly userSettingsRepository: UserSettingsRepository;

  /**
   * Creates a settings service.
   *
   * @param userSettingsRepository - User settings persistence boundary.
   */
  public constructor(userSettingsRepository: UserSettingsRepository) {
    this.userSettingsRepository = userSettingsRepository;
  }

  /**
   * Returns the settings for a user, falling back to defaults.
   *
   * @param userId - User identifier.
   */
  public async getUserSettings(userId: string): Promise<UserSettings> {
    const stored = await this.userSettingsRepository.findByUserId(userId);
    const defaults = DEFAULT_USER_SETTINGS;

    return {
      dateFormat: pickValid(
        stored?.dateFormat,
        isUserDateFormat,
        defaults.dateFormat,
      ),
      language: stored?.language ?? defaults.language,
      notifications: toNotifications(stored),
      timezone: pickValid(stored?.timezone, isUserTimezone, defaults.timezone),
      weekStart: pickValid(
        stored?.weekStart,
        isUserWeekStart,
        defaults.weekStart,
      ),
    };
  }

  /**
   * Replaces the settings a user has chosen.
   *
   * @param userId - User identifier.
   * @param settings - Validated settings to persist.
   */
  public async updateSettings(
    userId: string,
    settings: UserSettings,
  ): Promise<void> {
    await this.userSettingsRepository.upsert(userId, {
      language: settings.language,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
      weekStart: settings.weekStart,
      notifyEmail: settings.notifications.email,
      notifyDesktop: settings.notifications.desktop,
      notifyMentions: settings.notifications.mentions,
      notifyAssignments: settings.notifications.assignments,
      notifyDueDates: settings.notifications.dueDates,
      notifyWeeklySummary: settings.notifications.weeklySummary,
    });
  }

  /**
   * Updates the language a user has chosen.
   *
   * @param userId - User identifier.
   * @param language - Language to persist.
   */
  public async updateLanguage(
    userId: string,
    language: Language,
  ): Promise<void> {
    await this.userSettingsRepository.upsertLanguage(userId, language);
  }
}
