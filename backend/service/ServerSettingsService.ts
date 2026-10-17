import { DEFAULT_PORT, isValidPort } from "@/backend/config/PagesConfig";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { isAcpSessionLimit } from "@/definition/AcpResource";
import { PERMISSION } from "@/definition/Role";
import { PAGES_VERSION } from "@/definition/Version";
import {
  DEFAULT_LOG_RETENTION_DAYS,
  isLogRetentionDays,
} from "@/definition/Logging";
import {
  logEvent,
  readLoggingStatus,
  updateLogRetention,
} from "@/backend/logging/Logger";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { ConfigFile } from "@/backend/config/ConfigFile";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { AcpResourceUpdateResult } from "@/definition/AcpResource";
import type { User } from "@/definition/User";
import type { LoggingStatus } from "@/definition/Logging";

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
 * Changes are written to `config.toml`. ACP admission and log retention apply
 * immediately; the port applies after restart and start parameters still win.
 */
export class ServerSettingsService {
  private static readonly acpUpdates = new WeakMap<
    AcpResourceScheduler,
    SerialQueue
  >();
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

  /** Reads retention and writer health only after a current system-admin authorization. */
  public async readLogging(actor: User): Promise<{
    readonly retentionDays: number;
    readonly status: LoggingStatus;
  }> {
    await this.requireLoggingManager(actor);
    return {
      retentionDays:
        (await this.configFile.read())?.logRetentionDays ??
        DEFAULT_LOG_RETENTION_DAYS,
      status: readLoggingStatus(),
    };
  }

  /** Persists validated retention before applying cleanup immediately to the running instance. */
  public async updateLogging(actor: User, days: number): Promise<boolean> {
    await this.requireLoggingManager(actor);
    if (!isLogRetentionDays(days)) return false;
    await this.configFile.update((config) => ({
      ...config,
      logRetentionDays: days,
    }));
    logEvent({
      level: "info",
      event: "logging.retention.changed",
      component: "ServerSettingsService",
      message: "Administrator changed log retention",
      metadata: { userId: actor.id, retentionDays: days },
    });
    await updateLogRetention(days);
    return true;
  }

  /** Serializes persistence and live admission changes across all administrator requests. */
  public async updateAcpResources(
    actor: User,
    limit: number,
    scheduler: AcpResourceScheduler,
  ): Promise<AcpResourceUpdateResult> {
    const updates =
      ServerSettingsService.acpUpdates.get(scheduler) ?? new SerialQueue();
    ServerSettingsService.acpUpdates.set(scheduler, updates);
    return updates.run(async () => {
      if (!(await this.canManage(actor))) throw new ServerSettingsDeniedError();
      if (!isAcpSessionLimit(limit))
        return { ok: false, error: "invalidSetting" };
      if (scheduler.snapshot().limitSource === "environment")
        return { ok: false, error: "environmentOverride" };
      await this.configFile.update((config) => ({
        ...config,
        maxConcurrentAcpSessions: limit,
      }));
      const resources = scheduler.updateMaxConcurrentAcpSessions(limit);
      logEvent({
        level: "info",
        event: "acp.resources.limit.changed",
        component: "ServerSettingsService",
        message: "Administrator changed global ACP admission limit",
        metadata: { userId: actor.id, maxConcurrentAcpSessions: limit },
      });
      return { ok: true, resources };
    });
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

  private async requireLoggingManager(actor: User): Promise<void> {
    if (await this.canManage(actor)) return;
    logEvent({
      level: "warn",
      event: "authorization.logging.denied",
      component: "ServerSettingsService",
      message: "System log settings access denied",
      metadata: { userId: actor.id },
    });
    throw new ServerSettingsDeniedError();
  }
}
