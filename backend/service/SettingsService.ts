import { LANGUAGE } from "@/language/Language";

import type { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import type { UserSettings } from "@/definition/Settings";
import type { Language } from "@/language/Language";

/** Default settings applied until a user chooses their own. */
const DEFAULT_USER_SETTINGS: UserSettings = {
  language: LANGUAGE.GERMAN,
};

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
    const language =
      await this.userSettingsRepository.findLanguageByUserId(userId);

    return { language: language ?? DEFAULT_USER_SETTINGS.language };
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
