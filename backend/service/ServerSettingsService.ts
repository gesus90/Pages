import { DEFAULT_PORT, isValidPort } from "@/backend/config/PagesConfig";
import { PERMISSION } from "@/definition/Role";
import { PAGES_VERSION } from "@/definition/Version";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { ConfigFile } from "@/backend/config/ConfigFile";
import type { User } from "@/definition/User";

/** Thrown when an actor may not change settings of the whole instance. */
export class ServerSettingsDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to change the server settings.");
    this.name = "ServerSettingsDeniedError";
  }
}

/** What an administrator sees about the running instance. */
export interface ServerStatus {
  readonly version: string;
  /** Database file in use; it cannot be changed here. */
  readonly databasePath: string | null;
  /** When this process started, as an ISO timestamp. */
  readonly startedAt: string;
}

/**
 * Reads and changes the server settings stored in the configuration file.
 *
 * @remarks
 * Changes are written to `config.toml` and take effect when Pages starts
 * the next time; a `--port` start parameter still wins over them.
 */
export class ServerSettingsService {
  private readonly configFile: ConfigFile;
  private readonly permissionService: PermissionService;

  /**
   * Creates the service.
   *
   * @param configFile - Configuration file of the instance.
   * @param permissionService - Decides who may change the settings.
   */
  public constructor(
    configFile: ConfigFile,
    permissionService: PermissionService,
  ) {
    this.configFile = configFile;
    this.permissionService = permissionService;
  }

  /**
   * Tells whether a user may see and change the server settings.
   *
   * @param actor - The signed-in user.
   */
  public async canManage(actor: User): Promise<boolean> {
    return this.permissionService.allows(actor, PERMISSION.MANAGE_APPLICATION);
  }

  /** Returns the port stored for the next start. */
  public async readPort(): Promise<number> {
    return (await this.configFile.read())?.port ?? DEFAULT_PORT;
  }

  /** Returns version, database file and start time of the running process. */
  public async readStatus(): Promise<ServerStatus> {
    return {
      databasePath: (await this.configFile.read())?.databasePath ?? null,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      version: PAGES_VERSION,
    };
  }

  /**
   * Stores the port for the next start.
   *
   * @param actor - The signed-in user.
   * @param port - Requested port.
   * @returns Whether the port was valid and stored.
   * @throws {ServerSettingsDeniedError} When the actor may not change it.
   */
  public async updatePort(actor: User, port: number): Promise<boolean> {
    if (!(await this.canManage(actor))) {
      throw new ServerSettingsDeniedError();
    }

    if (!isValidPort(port)) {
      return false;
    }

    await this.configFile.update((config) => ({ ...config, port }));

    return true;
  }
}
