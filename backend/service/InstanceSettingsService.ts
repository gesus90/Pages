import { INSTANCE_LOGO_PATH } from "@/definition/Instance";
import { MAXIMUM_COMPANY_NAME_LENGTH } from "@/definition/Setup";
import { PERMISSION } from "@/definition/Role";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type {
  InstanceSettingsRepository,
  StoredInstanceLogo,
} from "@/backend/database/repositories/InstanceSettingsRepository";
import type { InstanceBranding } from "@/definition/Instance";
import type { User } from "@/definition/User";

/** Thrown when an actor may not change the settings of the instance. */
export class InstanceSettingsDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to change the instance settings.");
    this.name = "InstanceSettingsDeniedError";
  }
}

/**
 * Reads and changes what identifies the instance: company name and logo.
 *
 * @remarks
 * Both are stored in the database and apply at once. Everyone may read
 * them, since the login page shows them; only administrators change them.
 */
export class InstanceSettingsService {
  private readonly repository: InstanceSettingsRepository;
  private readonly permissionService: PermissionService;

  /**
   * Creates the service.
   *
   * @param repository - Persistence of the instance settings.
   * @param permissionService - Decides who may change the settings.
   */
  public constructor(
    repository: InstanceSettingsRepository,
    permissionService: PermissionService,
  ) {
    this.repository = repository;
    this.permissionService = permissionService;
  }

  /**
   * Returns company name and logo address as every visitor sees them.
   *
   * @remarks
   * The logo address carries the time of the upload, so browsers load a new
   * logo at once and keep an unchanged one.
   */
  public async getBranding(): Promise<InstanceBranding> {
    const [settings, logoVersion] = await Promise.all([
      this.repository.find(),
      this.repository.findLogoVersion(),
    ]);

    return {
      companyName: settings?.companyName ?? null,
      logoUrl:
        logoVersion === null
          ? null
          : `${INSTANCE_LOGO_PATH}?v=${encodeURIComponent(logoVersion)}`,
    };
  }

  /** Returns the stored logo image, or `null` when none was uploaded. */
  public async getLogo(): Promise<StoredInstanceLogo | null> {
    return this.repository.findLogo();
  }

  /**
   * Changes the company name.
   *
   * @param actor - The signed-in user.
   * @param companyName - Requested name; surrounding blanks do not count.
   * @returns Whether the name was valid and stored.
   * @throws {InstanceSettingsDeniedError} When the actor may not change it.
   */
  public async updateCompanyName(
    actor: User,
    companyName: string,
  ): Promise<boolean> {
    await this.requireManager(actor);

    const trimmedName = companyName.trim();

    if (
      trimmedName.length === 0 ||
      trimmedName.length > MAXIMUM_COMPANY_NAME_LENGTH
    ) {
      return false;
    }

    await this.repository.updateCompanyName(trimmedName);

    return true;
  }

  /**
   * Replaces the company logo.
   *
   * @param actor - The signed-in user.
   * @param logo - Validated image and its type.
   * @throws {InstanceSettingsDeniedError} When the actor may not change it.
   */
  public async replaceLogo(
    actor: User,
    logo: Pick<StoredInstanceLogo, "data" | "mimeType">,
  ): Promise<void> {
    await this.requireManager(actor);
    await this.repository.saveLogo(logo);
  }

  /**
   * Removes the company logo.
   *
   * @param actor - The signed-in user.
   * @throws {InstanceSettingsDeniedError} When the actor may not change it.
   */
  public async removeLogo(actor: User): Promise<void> {
    await this.requireManager(actor);
    await this.repository.deleteLogo();
  }

  private async requireManager(actor: User): Promise<void> {
    if (
      !(await this.permissionService.allows(
        actor,
        PERMISSION.MANAGE_APPLICATION,
      ))
    ) {
      throw new InstanceSettingsDeniedError();
    }
  }
}
