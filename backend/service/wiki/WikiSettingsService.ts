import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { PERMISSION } from "@/definition/Role";
import { WIKI_SETTING_DEFAULTS, WIKI_SETTING_RANGES } from "@/definition/Wiki";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiSettings } from "@/definition/Wiki";

/** Reads and changes the settings of the wiki. */
export class WikiSettingsService {
  private readonly repository: WikiRepository;
  private readonly permissionService: PermissionService;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param permissionService - Decides who may change the settings.
   */
  public constructor(
    repository: WikiRepository,
    permissionService: PermissionService,
  ) {
    this.repository = repository;
    this.permissionService = permissionService;
  }

  /**
   * Returns the settings that apply.
   *
   * @returns The stored settings, or the defaults while none were saved.
   */
  public async get(): Promise<WikiSettings> {
    return (await this.repository.settings.find()) ?? WIKI_SETTING_DEFAULTS;
  }

  /**
   * Replaces the settings.
   *
   * @param actor - The signed-in user; an administrator in the admin mode.
   * @param settings - The new values.
   * @throws {InstanceSettingsDeniedError} When the actor may not change them.
   * @throws {WikiValidationError} When a value is outside its range.
   */
  public async update(actor: User, settings: WikiSettings): Promise<void> {
    if (
      !(await this.permissionService.allows(
        actor,
        PERMISSION.MANAGE_APPLICATION,
      ))
    ) {
      throw new InstanceSettingsDeniedError();
    }

    for (const key of Object.keys(
      WIKI_SETTING_RANGES,
    ) as (keyof WikiSettings)[]) {
      const { max, min } = WIKI_SETTING_RANGES[key];
      const value = settings[key];

      if (!Number.isInteger(value) || value < min || value > max) {
        throw new WikiValidationError("invalidSetting");
      }
    }

    await this.repository.settings.save(settings);
  }
}
