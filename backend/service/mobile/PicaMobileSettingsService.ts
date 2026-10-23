import { isValidPort } from "@/backend/config/PagesConfig";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { PERMISSION } from "@/definition/Role";

import {
  listExternalIpv4Addresses,
  resolvePicaMobileHost,
} from "./PicaMobileAddress";
import { PicaMobileListenError } from "./PicaMobileGateway";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { ConfigFile } from "@/backend/config/ConfigFile";
import type {
  PicaMobilePortError,
  PicaMobilePortResult,
  PicaMobileSettingsView,
} from "@/definition/PicaMobile";
import type { User } from "@/definition/User";
import type { PicaMobileGateway } from "./PicaMobileGateway";

/** Thrown when an actor may not see or change the Pica Mobile settings. */
export class PicaMobileSettingsDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to manage Pica Mobile.");
    this.name = "PicaMobileSettingsDeniedError";
  }
}

/** What the service works with. */
export interface PicaMobileSettingsDependencies {
  readonly configFile: ConfigFile;
  readonly permissionService: PermissionService;
  readonly gateway: PicaMobileGateway;
  /** External addresses of this machine; tests replace it. */
  readonly readNetworkAddresses?: () => readonly string[];
}

/**
 * Reads and changes the port of the Pica Mobile endpoint.
 *
 * @remarks
 * The port is stored in the configuration file. A change binds the new port
 * first and stores it only when that worked, so the previous setting keeps
 * working after a failure. Only administrators may use it.
 */
export class PicaMobileSettingsService {
  private readonly dependencies: PicaMobileSettingsDependencies;

  /**
   * Creates the service.
   *
   * @param dependencies - Configuration file, permissions and endpoint.
   */
  public constructor(dependencies: PicaMobileSettingsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Tells whether a user may see and change the Pica Mobile settings.
   *
   * @param actor - The signed-in user.
   */
  public async canManage(actor: User): Promise<boolean> {
    return this.dependencies.permissionService.allows(
      actor,
      PERMISSION.MANAGE_APPLICATION,
    );
  }

  /**
   * Describes the endpoint for the settings page.
   *
   * @param actor - The signed-in user.
   * @param requestHostname - Host the browser used to open Pages.
   * @returns The stored port, whether it is bound, and the host to tell the app.
   * @throws {PicaMobileSettingsDeniedError} When the actor may not see it.
   */
  public async read(
    actor: User,
    requestHostname: string,
  ): Promise<PicaMobileSettingsView> {
    await this.requireManager(actor);

    const config = await this.dependencies.configFile.read();
    const port = config?.picaMobilePort ?? null;
    const isListening =
      port !== null && this.dependencies.gateway.port === port;

    return {
      port,
      isListening,
      listenError: isListening ? null : this.describeInactivePort(port),
      host: resolvePicaMobileHost({
        requestHostname,
        listenAddress: config?.listenAddress,
        networkAddresses: (
          this.dependencies.readNetworkAddresses ?? listExternalIpv4Addresses
        )(),
      }),
    };
  }

  /**
   * Stores a port and makes the endpoint listen on it.
   *
   * @param actor - The signed-in user.
   * @param port - Requested port.
   * @returns The stored port, or why it was refused. A refusal changes
   * nothing: the previous listener and the stored port stay.
   * @throws {PicaMobileSettingsDeniedError} When the actor may not change it.
   */
  public async updatePort(
    actor: User,
    port: number,
  ): Promise<PicaMobilePortResult> {
    await this.requireManager(actor);

    if (!isValidPort(port)) {
      return { ok: false, error: "invalidPort" };
    }

    try {
      await this.dependencies.gateway.switchTo(port, async () => {
        await this.dependencies.configFile.update((config) => ({
          ...config,
          picaMobilePort: port,
        }));
      });
    } catch (error: unknown) {
      logCaughtError("PicaMobileSettingsService", error);

      if (error instanceof PicaMobileListenError) {
        return { ok: false, error: error.reason };
      }

      throw error;
    }

    logEvent({
      level: "info",
      event: "pica_mobile.port.changed",
      component: "PicaMobileSettingsService",
      message: "Administrator changed the Pica Mobile port",
      metadata: { userId: actor.id, port },
    });

    return { ok: true, port };
  }

  /** Names why the stored port is not bound; `null` while none is stored. */
  private describeInactivePort(
    port: number | null,
  ): PicaMobilePortError | null {
    if (port === null) {
      return null;
    }

    const failure = this.dependencies.gateway.failure;

    return failure?.port === port ? failure.reason : "listenFailed";
  }

  private async requireManager(actor: User): Promise<void> {
    if (await this.canManage(actor)) {
      return;
    }

    logEvent({
      level: "warn",
      event: "authorization.pica_mobile.denied",
      component: "PicaMobileSettingsService",
      message: "Pica Mobile settings access denied",
      metadata: { userId: actor.id },
    });

    throw new PicaMobileSettingsDeniedError();
  }
}
