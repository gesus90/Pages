import path from "node:path";

import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { BoardPreferencesService } from "@/backend/service/BoardPreferencesService";
import { DesignThemeService } from "@/backend/service/DesignThemeService";
import { DesignThemeRegistry } from "@/backend/service/design/DesignThemeRegistry";
import { SettingsService } from "@/backend/service/SettingsService";

import type { Database } from "@/backend/database/Database";

/** Name of the directory next to the database that holds the design themes. */
const DESIGN_THEMES_DIRECTORY_NAME = "themes";

/** The personal preferences of a user: settings, design theme and board. */
export interface PreferenceApplicationServices {
  readonly boardPreferencesService: BoardPreferencesService;
  readonly settingsService: SettingsService;
  /** The personal design theme and the themes installed next to the database. */
  readonly designThemeService: DesignThemeService;
}

/**
 * Creates the services for the preferences of a user.
 *
 * @param database - Central database access.
 * @param databasePath - Path of the database; the design themes live next to it.
 * @returns The settings, design theme and board preference services.
 */
export function createPreferenceServices(
  database: Database,
  databasePath: string,
): PreferenceApplicationServices {
  const userSettingsRepository = new UserSettingsRepository(database);

  return {
    settingsService: new SettingsService(userSettingsRepository),
    designThemeService: new DesignThemeService(
      new DesignThemeRegistry(
        path.join(path.dirname(databasePath), DESIGN_THEMES_DIRECTORY_NAME),
      ),
      userSettingsRepository,
    ),
    boardPreferencesService: new BoardPreferencesService(
      new UserBoardPreferencesRepository(database),
    ),
  };
}
