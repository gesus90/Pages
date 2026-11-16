import { RemoteError } from "@/backend/error/RemoteErrors";

import { isInstallConfirmed } from "./RemoteInstallView";
import { RemoteSetupConductor } from "./RemoteSetupConductor";

import type { RunnerMaintenanceService } from "@/backend/service/runner/RunnerMaintenanceService";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerSetupService } from "@/backend/service/runner/RunnerSetupService";
import type { RemoteConnectionService } from "../RemoteConnectionService";
import type {
  RemoteConsoleOpenContext,
  RemoteConsoleSetupAccess,
} from "../RemoteConsoleService";
import type { RemoteConsoleTarget } from "../RemoteConsoleSession";
import type { RemoteInstallService } from "./RemoteInstallService";

/** What the setup rules and its conductors are built from. */
export interface RemoteSetupDependencies {
  readonly connections: Pick<RemoteConnectionService, "requireSetup">;
  readonly runners: Pick<
    RunnerService,
    "authorize" | "requireSetup" | "status"
  >;
  readonly delivery: Pick<
    RunnerSetupService,
    "transfer" | "verify" | "makeExecutable" | "launchCommand"
  >;
  readonly sessions: RemoteSessionRegistry;
  readonly install: Pick<RemoteInstallService, "inspect" | "current">;
  readonly maintenance: RunnerMaintenanceService;
}

/**
 * The rules of the runner setup that start from a connection's context menu.
 * @remarks
 * A start needs an administrator in the active admin mode who also belongs to
 * the connection's department, a pinned host key, nothing confirmed installed
 * and no registration of a runner yet. The stable SSH session and the current
 * check are verified by the run itself, right before anything is written.
 * Whoever opens the setup console again is held to the same rules.
 */
export class RemoteSetupService implements RemoteConsoleSetupAccess {
  private readonly dependencies: RemoteSetupDependencies;

  public constructor(dependencies: RemoteSetupDependencies) {
    this.dependencies = dependencies;
  }

  /** Rights that must hold for as long as the run exists. */
  public async requireAccess(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    await this.dependencies.connections.requireSetup(userId, connectionId);
  }

  /**
   * The conditions of a start, enforced here whatever the menu showed.
   * @param userId - The person who starts the setup.
   * @param connectionId - The connection.
   * @throws {RemoteError} `remote_setup_installed` after a confirmed installation,
   * `remote_setup_registered` while a runner registration exists.
   */
  public async requireStart(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    await this.requireAccess(userId, connectionId);
    const { install, runners } = this.dependencies;
    const view = await install.current(connectionId);
    if (view.components !== null && isInstallConfirmed(view.components))
      throw new RemoteError("remote_setup_installed");
    if ((await runners.status(connectionId)).isPaired)
      throw new RemoteError("remote_setup_registered");
  }

  /**
   * The target of one setup console: the shared SSH connection and a conductor for the run.
   * @param userId - The person who owns the console.
   * @param connectionId - The connection.
   * @param context - Where the request came from, which names Pages for the runner.
   * @returns The target, with the rules checked again.
   */
  public async target(
    userId: string,
    connectionId: string,
    context: RemoteConsoleOpenContext,
  ): Promise<RemoteConsoleTarget> {
    const record = await this.dependencies.connections.requireSetup(
      userId,
      connectionId,
    );
    return {
      session: this.dependencies.sessions.session(connectionId),
      path: null,
      conductor: new RemoteSetupConductor({
        userId,
        connectionId,
        pairing: () =>
          this.dependencies.maintenance.pairing(
            connectionId,
            context.origin,
            record.host,
          ),
        connections: this.dependencies.connections,
        runners: this.dependencies.runners,
        delivery: this.dependencies.delivery,
        sessions: this.dependencies.sessions,
        install: this.dependencies.install,
        requireStart: () => this.requireStart(userId, connectionId),
      }),
    };
  }
}
